import 'dotenv/config';
import Decimal from 'decimal.js';
import { loadEnvConfig, getGridConfigFromEnv } from './config';
import { CcxtExchangeAdapter } from './exchange/adapter';
import { CcxtExchangeStreams, MockExchangeStreams, IExchangeStreams } from './exchange/streams';
import { GridManager } from './core/gridManager';
import { RiskGuard } from './core/riskGuard';
import { StateRepository } from './db/repository';
import { Bootstrapper } from './core/bootstrapper';

async function bootstrap() {
  console.log('====================================================');
  console.log('🚀 Iniciando Bot de Grid Trading (Bitcoin / BTC)');
  console.log('====================================================');

  // 1. Cargar y validar configuración de entorno
  const env = loadEnvConfig();
  console.log(`[Bootstrapping] Exchange: ${env.EXCHANGE_ID.toUpperCase()} | Testnet: ${env.EXCHANGE_TESTNET}`);

  // 2. Extraer configuración dinámica de la grilla desde el entorno
  const gridConfig = getGridConfigFromEnv(env);
  console.log(
    `[Config Grilla Dinámica] Par: ${gridConfig.symbol} | Rango: $${gridConfig.lowerPrice.toFixed(2)} - $${gridConfig.upperPrice.toFixed(2)} | Niveles: ${gridConfig.gridLevels} | Inversión: $${gridConfig.investment.toFixed(2)}`
  );

  // 3. Inicializar componentes del sistema
  const exchangeAdapter = new CcxtExchangeAdapter({
    exchangeId: env.EXCHANGE_ID,
    apiKey: env.EXCHANGE_API_KEY,
    secret: env.EXCHANGE_SECRET,
    isTestnet: env.EXCHANGE_TESTNET,
  });

  const exchangeStreams: IExchangeStreams = env.EXCHANGE_API_KEY
    ? new CcxtExchangeStreams({
        exchangeId: env.EXCHANGE_ID,
        apiKey: env.EXCHANGE_API_KEY,
        secret: env.EXCHANGE_SECRET,
        isTestnet: env.EXCHANGE_TESTNET,
      })
    : new MockExchangeStreams();

  const gridManager = new GridManager(gridConfig);
  const riskGuard = new RiskGuard(new Decimal(env.MAX_ORDER_VALUE_USD), env.MAX_OPEN_ORDERS);
  const stateRepository = new StateRepository();
  const bootstrapper = new Bootstrapper(exchangeAdapter, stateRepository, gridManager);

  // 4. Configuración del Graceful Shutdown (Cierre Limpio del Sistema)
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Graceful Shutdown] 🛑 Señal ${signal} recibida. Iniciando cierre ordenado del bot...`);

    try {
      console.log('[Graceful Shutdown] 🔌 Cerrando conexiones de WebSockets...');
      await exchangeStreams.close();

      console.log('[Graceful Shutdown] 🗄️ Desconectando cliente de PostgreSQL / Prisma...');
      await stateRepository.disconnect();

      console.log('====================================================');
      console.log('✅ Bot finalizado limpiamente. ¡Hasta luego!');
      console.log('====================================================');
      process.exit(0);
    } catch (err) {
      console.error('[Graceful Shutdown Error] Error durante la desconexión:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // 5. Conectar adaptador de Exchange y validar precio de mercado
  let currentMarketPrice = new Decimal('64500.00'); // Precio fallback centrado en $64,500
  try {
    await exchangeAdapter.initialize();
    const ticker = await exchangeAdapter.fetchTicker(gridConfig.symbol);
    currentMarketPrice = ticker.last;
    console.log(`[Market Data] Precio actual en tiempo real ${gridConfig.symbol}: $${currentMarketPrice.toFixed(2)} USDT`);
  } catch (error) {
    console.warn('[Market Data] No se pudo conectar con la API en vivo. Utilizando precio simulado:', currentMarketPrice.toString());
  }

  // Verificación de Rango "Out of Bounds"
  if (currentMarketPrice.lessThan(gridConfig.lowerPrice) || currentMarketPrice.greaterThan(gridConfig.upperPrice)) {
    console.warn(
      `[Grid Warning] ⚠️ El precio actual ($${currentMarketPrice.toFixed(2)}) está FUERA del rango de la grilla ($${gridConfig.lowerPrice.toFixed(2)} - $${gridConfig.upperPrice.toFixed(2)}).`
    );
  } else {
    console.log(`[Grid Bounds] ✅ El precio actual ($${currentMarketPrice.toFixed(2)}) está correctamente centrado dentro del rango de la grilla.`);
  }

  // 6. Reconciliación de Estado & Bootstrapping de Resiliencia
  console.log('[Bootstrapping] Ejecutando reconciliación de estado...');
  const reconcileResult = await bootstrapper.reconcile(gridConfig.symbol);

  if (reconcileResult.isFreshGrid) {
    console.log('[Grid Seeding] Grilla nueva detectada. Guardando niveles y realizando siembra inicial...');
    
    // Guardar niveles estáticos en PostgreSQL
    for (const level of gridManager.getLevels()) {
      try {
        await stateRepository.upsertGridLevel(level.levelIndex, level.price, false);
      } catch (err) {
        console.warn(`[DB Sync] Advertencia al sincronizar nivel ${level.levelIndex} en BD:`, err);
      }
    }

    // Sembrar órdenes iniciales
    const seedOrders = gridManager.generateSeedOrders(currentMarketPrice);
    let placedCount = 0;

    for (const seedPlan of seedOrders) {
      const riskCheck = riskGuard.validateOrder(
        {
          symbol: gridConfig.symbol,
          type: 'limit',
          side: seedPlan.side,
          amount: seedPlan.amount,
          price: seedPlan.price,
        },
        placedCount
      );

      if (!riskCheck.valid) {
        console.error(`[Risk Guard Reject] Orden nivel ${seedPlan.levelIndex} rechazada: ${riskCheck.reason}`);
        continue;
      }

      console.log(`[Grid Seeding] Colocando orden de ${seedPlan.side.toUpperCase()} LIMIT en Nivel ${seedPlan.levelIndex} @ $${seedPlan.price.toFixed(2)} (${seedPlan.amount} BTC)`);

      try {
        await stateRepository.createOrderRecord({
          symbol: gridConfig.symbol,
          side: seedPlan.side === 'buy' ? 'BUY' : 'SELL',
          price: seedPlan.price,
          amount: seedPlan.amount,
          gridLevelId: seedPlan.levelIndex,
          status: 'PENDING',
        });
        placedCount++;
      } catch (err) {
        console.error(`[Grid Seeding Error] Error al persistir orden en Nivel ${seedPlan.levelIndex}:`, err);
      }
    }

    console.log(`[Grid Seeding] Se sembraron ${placedCount} órdenes iniciales exitosamente.`);
  } else {
    console.log(`[Bootstrapping Resumen] Estado recuperado: ${reconcileResult.restoredOpenOrdersCount} órdenes activas, ${reconcileResult.offlineFillsCount} fills offline procesados, ${reconcileResult.newFlipsCreatedCount} contra-órdenes creadas.`);
  }

  // 7. Conectar Stream de WebSockets para Captura de Ejecuciones en Tiempo Real
  await exchangeStreams.subscribeOrders(gridConfig.symbol);

  // Escuchar ejecuciones entrantes desde el WebSocket -> Disparar contra-orden ("Flip")
  exchangeStreams.on('order:filled', (event) => {
    console.log(`[WebSocket Stream] ⚡ Orden ejecutada recibida en tiempo real (ID: ${event.id}) Side: ${event.side.toUpperCase()} @ $${event.price.toFixed(2)}`);
    gridManager.handleOrderFill(event);
  });

  // 8. Orquestación del Event Bus para Contra-Órdenes ("Flips") en Tiempo Real
  gridManager.on('grid:flip_required', async (flipPlan) => {
    console.log(`[EventBus] 🔄 FLIP REQUERIDO: Nivel ${flipPlan.levelIndex} | Side: ${flipPlan.side.toUpperCase()} @ $${flipPlan.price.toFixed(2)}`);

    const riskCheck = riskGuard.validateOrder(
      {
        symbol: gridConfig.symbol,
        type: 'limit',
        side: flipPlan.side,
        amount: flipPlan.amount,
        price: flipPlan.price,
      },
      0
    );

    if (!riskCheck.valid) {
      console.error(`[Risk Guard Reject] Contra-orden rechazada: ${riskCheck.reason}`);
      return;
    }

    try {
      await stateRepository.createOrderRecord({
        symbol: gridConfig.symbol,
        side: flipPlan.side === 'buy' ? 'BUY' : 'SELL',
        price: flipPlan.price,
        amount: flipPlan.amount,
        gridLevelId: flipPlan.levelIndex,
        status: 'PENDING',
      });
      console.log(`[EventBus] ✅ Contra-orden registrada en BD para Nivel ${flipPlan.levelIndex} @ $${flipPlan.price.toFixed(2)}`);
    } catch (err) {
      console.error(`[EventBus Error] Error al colocar contra-orden:`, err);
    }
  });

  console.log('====================================================');
  console.log('✅ Bot inicializado, reconciliado y escuchando WebSockets en tiempo real.');
  console.log('====================================================');
}

bootstrap().catch((error) => {
  console.error('[Fatal Error] Excepción no controlada durante la inicialización:', error);
  process.exit(1);
});
