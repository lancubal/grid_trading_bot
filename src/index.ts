import 'dotenv/config';
import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { OrderSide, OrderStatus } from '@prisma/client';
import { loadEnvConfig, getGridConfigFromEnv } from './config';
import { StateRepository } from './db/repository';
import { CcxtExchangeAdapter, IExchangeAdapter } from './exchange/adapter';
import { GridManager } from './core/gridManager';
import { RiskGuard } from './core/riskGuard';
import { Bootstrapper } from './core/bootstrapper';
import { AtrCalculator } from './core/atrCalculator';
import { LiveVolatilityEngine } from './core/volatility';
import { OHLCV } from './backtest/backtester';

async function main() {
  console.log('====================================================');
  console.log('🤖 INICIANDO BOT DE GRID TRADING CON VOLATILIDAD ATR');
  console.log('====================================================');

  const env = loadEnvConfig();
  const rawGridConfig = getGridConfigFromEnv(env);

  console.log(`[Config] Entorno: ${env.NODE_ENV} | Modo DRY_RUN (Shadow Trading): ${env.DRY_RUN}`);
  console.log(`[Config ATR] Período: ${env.ATR_PERIOD} | Timeframe: ${env.ATR_TIMEFRAME} | Rango: $${env.MIN_GRID_RANGE_USD} - $${env.MAX_GRID_RANGE_USD} USD`);

  // 1. Inicializar Repositorio de Estado DB
  const repository = new StateRepository();

  // 2. Configurar Adaptador Proxy de Exchange (Lectura Mercado Real + Interceptor Condicional de Órdenes)
  const exchangeConfig = {
    exchangeId: env.EXCHANGE_ID,
    apiKey: env.EXCHANGE_API_KEY,
    secret: env.EXCHANGE_API_SECRET,
    isTestnet: env.EXCHANGE_TESTNET,
    isDryRun: env.DRY_RUN,
  };

  const exchangeAdapter: IExchangeAdapter = new CcxtExchangeAdapter(exchangeConfig);
  await exchangeAdapter.initialize();

  // 3. Descargar velas recientes para calcular ATR inicial y adaptar ancho de grilla
  const symbol = env.GRID_SYMBOL;
  const ccxtPublic = new ccxt.binance({ enableRateLimit: true });
  console.log(`[ATR Calculation] Descargando velas de ${env.ATR_TIMEFRAME} para calcular volatilidad de ${symbol}...`);

  let initialAtr = new Decimal(500);
  try {
    const rawCandles = await ccxtPublic.fetchOHLCV(symbol, env.ATR_TIMEFRAME, undefined, 30);
    if (rawCandles && rawCandles.length > 0) {
      const parsedCandles: OHLCV[] = rawCandles.map((c) => ({
        timestamp: typeof c[0] === 'number' ? c[0] : Date.now(),
        open: new Decimal(c[1] ?? 0),
        high: new Decimal(c[2] ?? 0),
        low: new Decimal(c[3] ?? 0),
        close: new Decimal(c[4] ?? 0),
        volume: new Decimal(c[5] ?? 0),
      }));
      initialAtr = AtrCalculator.calculate(parsedCandles, env.ATR_PERIOD);
      console.log(`[ATR Calculation] ATR Calculado (${env.ATR_TIMEFRAME}): $${initialAtr.toFixed(2)} USD`);
    }
  } catch (err) {
    console.warn('[ATR Warning] No se pudieron descargar velas live para ATR. Usando fallback $500 USD:', err);
  }

  // 4. Obtener Precio de Mercado Actual
  const initialTicker = await exchangeAdapter.fetchTicker(symbol);
  const currentPrice = initialTicker.last;
  console.log(`[Market Data] Precio actual de mercado para ${symbol}: $${currentPrice.toFixed(2)} USD`);

  // 5. Inicializar GridManager y ajustar rango dinámico por ATR
  const gridManager = new GridManager(rawGridConfig);
  const adjustedGrid = gridManager.adjustToVolatility(
    initialAtr,
    currentPrice,
    4.0,
    env.MIN_GRID_RANGE_USD.toNumber(),
    env.MAX_GRID_RANGE_USD.toNumber()
  );

  console.log(`[Grid Bounds] Piso: $${adjustedGrid.newLowerPrice.toFixed(2)} | Techo: $${adjustedGrid.newUpperPrice.toFixed(2)} | Escalón: $${adjustedGrid.stepSize.toFixed(2)}`);

  // 6. Inicializar Guardián de Riesgo y Motor de Volatilidad en Vivo
  const riskGuard = new RiskGuard(env.MAX_ORDER_VALUE_USD, env.MAX_OPEN_ORDERS);
  const volatilityEngine = new LiveVolatilityEngine(15); // Emite VOLATILITY_CHANGE si varía >= 15%

  // 7. Ejecutar Reconciliador / Bootstrapper al reiniciar
  const bootstrapper = new Bootstrapper(exchangeAdapter, repository, gridManager);
  await bootstrapper.reconcile(symbol);

  // 8. Siembra Inicial de Órdenes si es una Grilla Nueva
  const openOrdersInDb = await repository.getOpenOrders();

  for (const level of gridManager.getLevels()) {
    await repository.upsertGridLevel(level.levelIndex, level.price, false);
  }

  if (openOrdersInDb.length === 0) {
    console.log('[Seeding] Generando órdenes de siembra iniciales con UUID v4...');
    const seedPlans = gridManager.generateSeedOrders(currentPrice);

    for (const plan of seedPlans) {
      const riskCheck = riskGuard.validateOrder(
        {
          symbol,
          type: 'limit',
          side: plan.side,
          amount: plan.amount,
          price: plan.price,
        },
        openOrdersInDb.length
      );

      if (!riskCheck.valid) {
        console.warn(`[Risk Guard Alert] Orden de siembra rechazada: ${riskCheck.reason}`);
        continue;
      }

      const createdOrder = await exchangeAdapter.createOrder({
        symbol,
        type: 'limit',
        side: plan.side,
        amount: plan.amount,
        price: plan.price,
      });

      await repository.createOrderRecord({
        exchangeId: createdOrder.id,
        symbol: createdOrder.symbol,
        side: plan.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
        price: createdOrder.price,
        amount: createdOrder.amount,
        gridLevelId: plan.levelIndex,
        status: OrderStatus.OPEN,
      });
    }

    console.log(`[Seeding] 🚀 Siembra inicial completada: ${seedPlans.length} órdenes límite guardadas con estado OPEN.`);
  }

  // 9. Reacción al Evento VOLATILITY_CHANGE: Cancelar órdenes virtuales y re-dibujar 15 escalones
  volatilityEngine.on('VOLATILITY_CHANGE', async (newAtr: Decimal) => {
    console.log(`\n[Rebalance Trigger] ⚡ Evento VOLATILITY_CHANGE Recibido (Nuevo ATR: $${newAtr.toFixed(2)} USD). Re-ajustando grilla...`);

    const latestTicker = await exchangeAdapter.fetchTicker(symbol);
    const rebalanced = gridManager.adjustToVolatility(
      newAtr,
      latestTicker.last,
      4.0,
      env.MIN_GRID_RANGE_USD.toNumber(),
      env.MAX_GRID_RANGE_USD.toNumber()
    );

    // Cancelar órdenes virtuales abiertas
    const currentOpenOrders = await repository.getOpenOrders();
    for (const ord of currentOpenOrders) {
      if (ord.exchangeId) {
        await exchangeAdapter.cancelOrder(ord.exchangeId, symbol);
        await repository.updateOrderStatusById(ord.id, OrderStatus.CANCELED);
      }
    }

    // Actualizar niveles en BD y re-sembrar
    for (const level of gridManager.getLevels()) {
      await repository.upsertGridLevel(level.levelIndex, level.price, false);
    }

    const newSeedPlans = gridManager.generateSeedOrders(latestTicker.last);
    for (const plan of newSeedPlans) {
      const createdOrder = await exchangeAdapter.createOrder({
        symbol,
        type: 'limit',
        side: plan.side,
        amount: plan.amount,
        price: plan.price,
      });

      await repository.createOrderRecord({
        exchangeId: createdOrder.id,
        symbol: createdOrder.symbol,
        side: plan.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
        price: createdOrder.price,
        amount: createdOrder.amount,
        gridLevelId: plan.levelIndex,
        status: OrderStatus.OPEN,
      });
    }

    console.log(`[Rebalance Complete] ✨ Grilla Re-ajustada: Nuevo rango $${rebalanced.newLowerPrice.toFixed(2)} - $${rebalanced.newUpperPrice.toFixed(2)} USD (${newSeedPlans.length} órdenes re-sembradas).\n`);
  });

  // Iniciar el motor de volatilidad en vivo
  await volatilityEngine.start(symbol, env.ATR_TIMEFRAME, env.ATR_PERIOD);

  // 10. Bucle de Tickers de Mercado en Vivo (Binance Spot)
  console.log('====================================================');
  console.log('🟢 BOT OPERANDO EN TIEMPO REAL - SHADOW TRADING ACTIVE');
  console.log('====================================================');

  const tickerInterval = setInterval(async () => {
    try {
      const ticker = await exchangeAdapter.fetchTicker(symbol);
      const isOutOfBounds = ticker.last.lessThan(gridManager.getConfig().lowerPrice) || ticker.last.greaterThan(gridManager.getConfig().upperPrice);
      if (isOutOfBounds) {
        console.warn(`[Market Alert] ⚠️ Precio actual ($${ticker.last.toFixed(2)}) fuera del rango ($${gridManager.getConfig().lowerPrice.toFixed(2)} - $${gridManager.getConfig().upperPrice.toFixed(2)})`);
      }
    } catch (err) {
      console.error('[Ticker Loop Error]', err);
    }
  }, 2000);

  // Manejo de Shutdown Gracioso
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Recibida señal ${signal}. Cerrando bot de forma graciosa...`);
    clearInterval(tickerInterval);
    volatilityEngine.stop();
    await repository.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Fatal Error] Error no controlado en la aplicación:', err);
  process.exit(1);
});
