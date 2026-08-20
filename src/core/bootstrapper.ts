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
  hasInvertedOrders: boolean;
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
      hasInvertedOrders: false,
    };

    // 1. Verificar si existen niveles registrados en BD
    const dbLevels = await this.stateRepository.getAllGridLevels();
    if (dbLevels.length === 0) {
      console.log('[Bootstrapper] 🌱 No se encontraron niveles en BD. Se detectó una grilla nueva (Fresh Grid).');
      result.isFreshGrid = true;
      return result;
    }

    // 2. Obtener precio actual de mercado y órdenes abiertas
    let currentPrice: Decimal | null = null;
    try {
      const currentTicker = await this.exchangeAdapter.fetchTicker(symbol);
      if (currentTicker && currentTicker.last) {
        currentPrice = new Decimal(currentTicker.last);
      }
    } catch {
      // Ignorar si el adapter o mock no retorna ticker
    }

    const dbOpenOrders = await this.stateRepository.getOpenOrders();
    const exchangeOpenOrders = await this.exchangeAdapter.fetchOpenOrders(symbol);
    const activeExchangeOrderIds = new Set(exchangeOpenOrders.map((o) => o.id));

    console.log(
      `[Bootstrapper] BD: ${dbOpenOrders.length} órdenes abiertas/pendientes | Exchange: ${exchangeOpenOrders.length} órdenes activas${currentPrice ? ` | Precio Mercado: $${currentPrice.toFixed(2)} USD` : ''}`
    );

    // 3. Procesar cada orden en BD
    for (const dbOrder of dbOpenOrders) {
      const orderPrice = new Decimal(dbOrder.price);
      const isSellBelowPrice = currentPrice ? (dbOrder.side === 'SELL' && orderPrice.lessThan(currentPrice.times(0.999))) : false;
      const isBuyAbovePrice = currentPrice ? (dbOrder.side === 'BUY' && orderPrice.greaterThan(currentPrice.times(1.001))) : false;

      // Limpieza de órdenes invertidas respecto al precio actual
      if (isSellBelowPrice || isBuyAbovePrice) {
        console.warn(
          `[Bootstrapper Inversion Alert] ⚠️ Orden invertida detectada en Nivel ${dbOrder.gridLevelId} (${dbOrder.side} @ $${orderPrice.toFixed(2)} vs Precio Mercado $${currentPrice?.toFixed(2)}). Cancelando para re-alinear grilla.`
        );
        result.hasInvertedOrders = true;

        if (dbOrder.exchangeId) {
          await this.exchangeAdapter.cancelOrder(dbOrder.exchangeId, symbol);
        }
        await this.stateRepository.updateOrderStatusById(dbOrder.id, 'CANCELED');
        result.canceledOrdersCount++;
        continue;
      }

      if (dbOrder.exchangeId && activeExchangeOrderIds.has(dbOrder.exchangeId)) {
        // Caso A: La orden sigue abierta en el exchange -> Estado intacto
        result.restoredOpenOrdersCount++;
        console.log(`[Bootstrapper] ✅ Orden intacta restaurada en Nivel ${dbOrder.gridLevelId} (Exchange ID: ${dbOrder.exchangeId})`);
      } else if (dbOrder.exchangeId) {
        // Caso B: La orden ya no está en la lista de órdenes abiertas -> Consultar estado individual
        try {
          const exchangeOrder = await this.exchangeAdapter.fetchOrder(dbOrder.exchangeId, symbol);

          if (exchangeOrder && exchangeOrder.status === 'closed') {
            console.log(`[Bootstrapper] ⚡ Fill detectado offline: Orden ${dbOrder.exchangeId} Nivel ${dbOrder.gridLevelId} se ejecutó.`);
            
            // Actualizar orden como FILLED en BD registrando feeCurrency y feeCost
            const feeCost = exchangeOrder.fee?.cost;
            const feeCurrency = exchangeOrder.fee?.currency;
            await this.stateRepository.updateOrderStatusById(
              dbOrder.id,
              'FILLED',
              feeCost,
              feeCurrency,
              feeCost
            );
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
          } else if (exchangeOrder && (exchangeOrder.status === 'canceled' || exchangeOrder.status === 'expired' || exchangeOrder.status === 'rejected')) {
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

    console.log(`[Bootstrapper] ✨ Reconciliación completada: ${result.restoredOpenOrdersCount} restauradas, ${result.offlineFillsCount} fills offline, ${result.canceledOrdersCount} canceladas, ${result.newFlipsCreatedCount} flips creados.`);
    return result;
  }

  /**
   * Reactiva y concilia órdenes de la Bóveda Legacy:
   * 1. Si ya se ejecutaron offline en Binance ('closed'), las marca como FILLED en BD.
   * 2. Si siguen abiertas pero su precio está dentro o por debajo del mercado (<= maxPriceThreshold),
   *    las cancela en Binance para liberar el inventario BTC a saldo libre y permitir que
   *    la grilla activa las re-siembre simétricamente.
   */
  public async reactivateLegacyOrders(symbol: string, maxPriceThreshold: Decimal = new Decimal(999999)): Promise<number> {
    console.log(`[Bootstrapper] 🏛️ Evaluando y conciliando órdenes de Bóveda Legacy (Umbral: <= $${maxPriceThreshold.toFixed(2)} USD)...`);
    const openLegacyOrders = await this.stateRepository.getOpenLegacyOrders();
    let reactivatedCount = 0;

    for (const legacyOrd of openLegacyOrders) {
      if (legacyOrd.exchangeId) {
        try {
          const exOrder = await this.exchangeAdapter.fetchOrder(legacyOrd.exchangeId, symbol);
          if (exOrder && exOrder.status === 'closed') {
            await this.stateRepository.updateLegacyOrderStatusById(legacyOrd.id, 'FILLED');
            console.log(`[Bootstrapper Legacy] ⚡ Orden Legacy ${legacyOrd.exchangeId} ($${legacyOrd.price}) ya figuraba ejecutada en Binance. Marcada como FILLED en BD.`);
            continue;
          } else if (exOrder && (exOrder.status === 'canceled' || exOrder.status === 'expired')) {
            await this.stateRepository.updateLegacyOrderStatusById(legacyOrd.id, 'CANCELED');
            continue;
          }
        } catch {
          // Ignorar error si no se pudo consultar orden histórica
        }
      }

      const ordPrice = new Decimal(legacyOrd.price);
      if (ordPrice.lessThanOrEqualTo(maxPriceThreshold)) {
        if (legacyOrd.exchangeId) {
          try {
            await this.exchangeAdapter.cancelOrder(legacyOrd.exchangeId, symbol);
          } catch (err) {
            // Ignorar si ya no estaba abierta en exchange
          }
        }
        await this.stateRepository.updateLegacyOrderStatusById(legacyOrd.id, 'CANCELED');
        reactivatedCount++;
      }
    }

    console.log(`[Bootstrapper] 🚀 Conciliadas/reactivadas ${reactivatedCount} órdenes de Bóveda Legacy a saldo Spot.`);
    return reactivatedCount;
  }
}
