import Decimal from 'decimal.js';
import { IExchangeAdapter } from '../exchange/adapter';
import { StateRepository } from '../db/repository';
import { GridManager } from './gridManager';

export interface ReconcileResult {
  restoredOpenOrdersCount: number;
  offlineFillsCount: number;
  newFlipsCreatedCount: number;
  canceledOrdersCount: number;
  isFreshGrid: boolean;
}

/**
 * Bootstrapper / Gestor de Reconciliación de Estado.
 * Restaura y resincroniza el estado del bot comparando la base de datos PostgreSQL con el Exchange.
 */
export class Bootstrapper {
  private exchangeAdapter: IExchangeAdapter;
  private stateRepository: StateRepository;
  private gridManager: GridManager;

  constructor(
    exchangeAdapter: IExchangeAdapter,
    stateRepository: StateRepository,
    gridManager: GridManager
  ) {
    this.exchangeAdapter = exchangeAdapter;
    this.stateRepository = stateRepository;
    this.gridManager = gridManager;
  }

  /**
   * Ejecuta el proceso de reconciliación al arrancar o reiniciar el bot.
   */
  public async reconcile(symbol: string): Promise<ReconcileResult> {
    console.log(`[Bootstrapper] 🔍 Iniciando reconciliación de estado para ${symbol}...`);

    const result: ReconcileResult = {
      restoredOpenOrdersCount: 0,
      offlineFillsCount: 0,
      newFlipsCreatedCount: 0,
      canceledOrdersCount: 0,
      isFreshGrid: false,
    };

    // 1. Verificar si existen niveles registrados en BD
    const dbLevels = await this.stateRepository.getAllGridLevels();
    if (dbLevels.length === 0) {
      console.log('[Bootstrapper] 🌱 No se encontraron niveles en BD. Se detectó una grilla nueva (Fresh Grid).');
      result.isFreshGrid = true;
      return result;
    }

    // 2. Obtener órdenes pendientes/abiertas en BD y órdenes abiertas en Exchange
    const dbOpenOrders = await this.stateRepository.getOpenOrders();
    const exchangeOpenOrders = await this.exchangeAdapter.fetchOpenOrders(symbol);
    const activeExchangeOrderIds = new Set(exchangeOpenOrders.map((o) => o.id));

    console.log(`[Bootstrapper] BD: ${dbOpenOrders.length} órdenes abiertas/pendientes | Exchange: ${exchangeOpenOrders.length} órdenes activas`);

    // 3. Procesar cada orden en BD
    for (const dbOrder of dbOpenOrders) {
      if (dbOrder.exchangeId && activeExchangeOrderIds.has(dbOrder.exchangeId)) {
        // Caso A: La orden sigue abierta en el exchange -> Estado intacto
        result.restoredOpenOrdersCount++;
        console.log(`[Bootstrapper] ✅ Orden intacta restaurada en Nivel ${dbOrder.gridLevelId} (Exchange ID: ${dbOrder.exchangeId})`);
      } else if (dbOrder.exchangeId) {
        // Caso B: La orden ya no está en la lista de órdenes abiertas -> Consultar estado individual
        try {
          const exchangeOrder = await this.exchangeAdapter.fetchOrder(dbOrder.exchangeId, symbol);

          if (exchangeOrder.status === 'closed') {
            console.log(`[Bootstrapper] ⚡ Fill detectado offline: Orden ${dbOrder.exchangeId} Nivel ${dbOrder.gridLevelId} se ejecutó.`);
            
            // Actualizar orden como FILLED en BD
            await this.stateRepository.updateOrderStatusById(dbOrder.id, 'FILLED');
            result.offlineFillsCount++;

            // Generar contra-orden ("Flip")
            const flipPlan = this.gridManager.handleOrderFill({
              id: dbOrder.exchangeId,
              symbol: dbOrder.symbol,
              side: dbOrder.side === 'BUY' ? 'buy' : 'sell',
              type: 'limit',
              price: new Decimal(dbOrder.price),
              amount: new Decimal(dbOrder.amount),
              filled: new Decimal(dbOrder.amount),
              remaining: new Decimal(0),
              status: 'closed',
              timestamp: Date.now(),
              gridLevel: dbOrder.gridLevelId,
            });

            if (flipPlan) {
              // Enviar la contra-orden al exchange
              const placedFlip = await this.exchangeAdapter.createOrder({
                symbol,
                type: 'limit',
                side: flipPlan.side,
                price: flipPlan.price,
                amount: flipPlan.amount,
              });

              // Registrar la contra-orden en BD
              await this.stateRepository.createOrderRecord({
                exchangeId: placedFlip.id,
                symbol,
                side: flipPlan.side === 'buy' ? 'BUY' : 'SELL',
                price: flipPlan.price,
                amount: flipPlan.amount,
                gridLevelId: flipPlan.levelIndex,
                status: 'OPEN',
              });

              result.newFlipsCreatedCount++;
              console.log(`[Bootstrapper] 🔄 Contra-orden ("Flip") colocada en Exchange ID ${placedFlip.id} @ $${flipPlan.price.toFixed(2)}`);
            }
          } else if (exchangeOrder.status === 'canceled' || exchangeOrder.status === 'expired' || exchangeOrder.status === 'rejected') {
            console.warn(`[Bootstrapper] ⚠️ Orden ${dbOrder.exchangeId} cancelada/rechazada en exchange. Actualizando BD.`);
            await this.stateRepository.updateOrderStatusById(dbOrder.id, 'CANCELED');
            result.canceledOrdersCount++;
          }
        } catch (err) {
          console.error(`[Bootstrapper Error] Error al consultar orden ${dbOrder.exchangeId}:`, err);
        }
      } else {
        // Caso C: Orden registrada en BD como PENDING pero sin exchangeId -> Intentar colocarla
        try {
          const placedOrder = await this.exchangeAdapter.createOrder({
            symbol,
            type: 'limit',
            side: dbOrder.side === 'BUY' ? 'buy' : 'sell',
            price: new Decimal(dbOrder.price),
            amount: new Decimal(dbOrder.amount),
          });

          await this.stateRepository.updateOrderStatusById(dbOrder.id, 'OPEN');
          result.restoredOpenOrdersCount++;
          console.log(`[Bootstrapper] 🚀 Orden pendiente colocada en Exchange ID ${placedOrder.id}`);
        } catch (err) {
          console.error(`[Bootstrapper Error] Error enviando orden pendiente ID ${dbOrder.id}:`, err);
        }
      }
    }

    console.log(`[Bootstrapper] ✨ Reconciliación completada: ${result.restoredOpenOrdersCount} restauradas, ${result.offlineFillsCount} fills offline, ${result.newFlipsCreatedCount} flips creados.`);
    return result;
  }
}
