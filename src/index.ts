import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { OrderSide, OrderStatus } from '@prisma/client';
import { loadEnvConfig, getGridConfigFromEnv } from './config';
import { StateRepository } from './db/repository';
import { CcxtExchangeAdapter, IExchangeAdapter, isInsufficientFundsError } from './exchange/adapter';
import { CcxtExchangeStreams, IExchangeStreams } from './exchange/streams';
import { GridManager } from './core/gridManager';
import { RiskGuard } from './core/riskGuard';
import { Bootstrapper } from './core/bootstrapper';
import { AtrCalculator } from './core/atrCalculator';
import { LiveVolatilityEngine } from './core/volatility';
import { LocalMatchingEngine } from './core/matchingEngine';
import { SlackNotifier } from './core/notifier';
import { CircuitBreaker } from './core/circuitBreaker';
import { FomoGuard } from './core/fomoGuard';
import { setupDailyReportCron } from './cron/dailyReport';
import { OHLCV } from './backtest/backtester';

async function main() {
  console.log('====================================================');
  console.log('🤖 INICIANDO BOT DE GRID TRADING CON VOLATILIDAD ATR');
  console.log('====================================================');

  const env = loadEnvConfig();

  // Módulo de Notificaciones & Observabilidad (Slack)
  const notifier = new SlackNotifier(env.ENABLE_NOTIFICATIONS, env.SLACK_WEBHOOK_URL);
  console.log(`[Observability] 📡 Slack Notifier: ${notifier.isEnabled() ? 'ACTIVADO (Babysitting activo 🟢)' : 'SILENCIADO (Kill-Switch ENABLE_NOTIFICATIONS=false 🔴)'}`);

  // Cortacircuitos de Velocidad (Circuit Breaker) Anti-Flash Crash
  const circuitBreaker = new CircuitBreaker({
    dropThresholdPct: env.CIRCUIT_BREAKER_DROP_PCT,
    windowMins: env.CIRCUIT_BREAKER_WINDOW_MINS,
    cooldownHours: env.CIRCUIT_BREAKER_COOLDOWN_HOURS,
  });
  console.log(`[Circuit Breaker] ⚡ Cortacircuitos cargado (Umbral: -${env.CIRCUIT_BREAKER_DROP_PCT}% en ${env.CIRCUIT_BREAKER_WINDOW_MINS}m | Cooldown: ${env.CIRCUIT_BREAKER_COOLDOWN_HOURS}h)`);

  // Bloqueo FOMO (Escudo Anti-Comprar la Cima de un Pump)
  const fomoGuard = new FomoGuard({ cooldownHours: env.FOMO_COOLDOWN_HOURS });
  console.log(`[FomoGuard] 🛡️ Escudo Anti-FOMO cargado (Cooldown tras romper techo: ${env.FOMO_COOLDOWN_HOURS}h)`);

  // Consultar si existe un capital dinámico configurado en la BD
  const repository = new StateRepository();
  const dbInvestment = await repository.getBotConfig('GRID_INVESTMENT');
  const rawGridConfig = getGridConfigFromEnv(env);

  if (dbInvestment) {
    console.log(`[Config DB] 💰 Capital de grilla configurado dinámicamente: $${dbInvestment} USD`);
    rawGridConfig.investment = new Decimal(dbInvestment);
  }

  console.log(`[Config] Entorno: ${env.NODE_ENV} | Modo DRY_RUN (Shadow Trading): ${env.DRY_RUN}`);
  console.log(`[Config ATR] Período: ${env.ATR_PERIOD} | Timeframe: ${env.ATR_TIMEFRAME} | Rango: $${env.MIN_GRID_RANGE_USD} - $${env.MAX_GRID_RANGE_USD} USD`);

  const systemBus = new EventEmitter();

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

  let liveUsdtFree: Decimal | undefined;
  let liveBtcFree: Decimal | undefined;

  // 🔴 VALIDACIÓN DE BALANCE INICIAL (COLD START - PRODUCCIÓN EN VIVO)
  if (!env.DRY_RUN) {
    console.log('[Cold Start] 🔍 Verificando saldo físico real en Binance Spot via CCXT fetchBalance()...');
    try {
      const realBalance = await exchangeAdapter.fetchBalance();
      liveUsdtFree = realBalance.free['USDT'] ? new Decimal(realBalance.free['USDT']) : new Decimal(0);
      liveBtcFree = realBalance.free['BTC'] ? new Decimal(realBalance.free['BTC']) : new Decimal(0);

      const symbol = env.GRID_SYMBOL;
      const initialTicker = await exchangeAdapter.fetchTicker(symbol);
      const estPrice = initialTicker.last;
      const totalEquity = liveUsdtFree.plus(liveBtcFree.times(estPrice));

      console.log(
        `[Cold Start] 💰 Saldo físico verificado: $${liveUsdtFree.toFixed(2)} USDT libre | ${liveBtcFree.toFixed(6)} BTC libre ($${liveBtcFree.times(estPrice).toFixed(2)} USD) = Total Valorizado: $${totalEquity.toFixed(2)} USD.`
      );

      if (totalEquity.lessThan(rawGridConfig.investment.times(0.85))) {
        console.warn(
          `[Cold Start Alert] ⚠️ Saldo total valorizado ($${totalEquity.toFixed(2)} USD) es inferior al capital asignado a la grilla ($${rawGridConfig.investment.toFixed(2)} USD).`
        );

        if (exchangeAdapter.redeemSimpleEarnFlexible) {
          const missingUsdt = rawGridConfig.investment.minus(totalEquity);
          console.log(`[Cold Start Auto-Rescate] 💉 Intentando rescatar $${missingUsdt.toFixed(2)} USDT de Binance Simple Earn Flexible para completar capital de siembra...`);
          const rescue = await exchangeAdapter.redeemSimpleEarnFlexible('USDT', missingUsdt);
          if (rescue.success) {
            console.log(`[Cold Start Auto-Rescate] ✅ Rescate exitoso. Saldo Spot completado para la siembra inicial.`);
          }
        }
      }
    } catch (err: any) {
      console.error('[Cold Start Error] Error al consultar saldo inicial en Binance:', err.message || err);
    }
  }

  // 3. Descargar velas recientes para calcular ATR inicial y adaptar ancho de grilla
  const symbol = env.GRID_SYMBOL;
  const cleanSymbol = symbol.replace('/', '');
  console.log(`[ATR Calculation] Descargando velas de ${env.ATR_TIMEFRAME} para calcular volatilidad de ${symbol}...`);

  let initialAtr = new Decimal(500);
  try {
    let rawCandles: any[] = [];
    try {
      const res = await fetch(`https://api.binance.us/api/v3/klines?symbol=${cleanSymbol}&interval=${env.ATR_TIMEFRAME}&limit=30`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawCandles = data;
    } catch (err) {
      // Fallback
    }

    if (rawCandles.length === 0) {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${env.ATR_TIMEFRAME}&limit=30`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) rawCandles = data;
    }

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

  // 6. Inicializar Guardián de Riesgo, Motor de Volatilidad (25% umbral, 4h cooldown) y Matching Engine Local
  const riskGuard = new RiskGuard(env.MAX_ORDER_VALUE_USD, env.MAX_OPEN_ORDERS, env.MAX_GRID_ALLOCATION_USD);
  const volatilityEngine = new LiveVolatilityEngine(25, 4);
  const matchingEngine = new LocalMatchingEngine(repository, systemBus);

  // Helper de Autodefensa y Rescate Autónomo desde Binance Simple Earn Flexible
  const checkAndExecuteAutoInjection = async (isInsufficientFunds: boolean = false): Promise<boolean> => {
    try {
      const currentInvestmentStr = (await repository.getBotConfig('GRID_INVESTMENT')) || env.GRID_INVESTMENT.toString();
      const currentLifetimeAllocationStr = (await repository.getBotConfig('LIFETIME_ALLOCATION_USD')) || currentInvestmentStr;
      const lastInjectionStr = await repository.getBotConfig('LAST_INJECTION_TIMESTAMP');

      const currentInvestment = new Decimal(currentInvestmentStr);
      const currentLifetimeAllocation = new Decimal(currentLifetimeAllocationStr);

      const allLevels = await repository.getAllGridLevels();
      const btcHoldingCount = allLevels.filter((g) => g.isHolding).length;
      const estUsdtCash = Decimal.max(0, currentInvestment.minus(btcHoldingCount * 0.0011 * 64000));

      const validation = riskGuard.validateAutoInjection({
        enabled: env.ENABLE_AUTO_INJECT,
        currentUsdtCash: estUsdtCash,
        isInsufficientFunds,
        starvationThresholdUsd: env.STARVATION_THRESHOLD_USD,
        lastInjectionTimestamp: lastInjectionStr,
        autoInjectCooldownDays: env.AUTO_INJECT_COOLDOWN_DAYS,
        currentLifetimeAllocationUsd: currentLifetimeAllocation,
        autoInjectAmountUsd: env.AUTO_INJECT_AMOUNT_USD,
        maxLifetimeAllocationUsd: env.MAX_LIFETIME_ALLOCATION_USD,
      });

      if (validation.valid) {
        console.log(`[Auto-Injector] 💉 ALERTA DE SED: Rescatando $${env.AUTO_INJECT_AMOUNT_USD.toFixed(2)} USDT de Binance Simple Earn Flexible...`);

        if (exchangeAdapter.redeemSimpleEarnFlexible) {
          const result = await exchangeAdapter.redeemSimpleEarnFlexible('USDT', env.AUTO_INJECT_AMOUNT_USD);

          if (result.success) {
            const newInvestment = currentInvestment.plus(env.AUTO_INJECT_AMOUNT_USD);
            const newLifetimeAllocation = currentLifetimeAllocation.plus(env.AUTO_INJECT_AMOUNT_USD);
            const nowIso = new Date().toISOString();

            await repository.setBotConfig('GRID_INVESTMENT', newInvestment.toString());
            await repository.setBotConfig('LIFETIME_ALLOCATION_USD', newLifetimeAllocation.toString());
            await repository.setBotConfig('LAST_INJECTION_TIMESTAMP', nowIso);

            console.log(
              `[Auto-Injector] ✅ RESCATE COMPLETADO: $${env.AUTO_INJECT_AMOUNT_USD.toFixed(2)} USDT transferidos desde Simple Earn Flexible ➔ Spot. Nuevo capital grilla: $${newInvestment.toFixed(2)} USD | Total asignado acumulado: $${newLifetimeAllocation.toFixed(2)} / $${env.MAX_LIFETIME_ALLOCATION_USD.toFixed(2)} USD | Cooldown ${env.AUTO_INJECT_COOLDOWN_DAYS} días activado.\n`
            );

            // Notificación a Slack
            await notifier.notifyAutoInjection({
              amountUsd: env.AUTO_INJECT_AMOUNT_USD.toNumber(),
              lifetimeAllocationUsd: newLifetimeAllocation.toNumber(),
              maxLifetimeAllocationUsd: env.MAX_LIFETIME_ALLOCATION_USD.toNumber(),
              cooldownDays: env.AUTO_INJECT_COOLDOWN_DAYS,
            });

            return true;
          }
        }
      }
    } catch (err) {
      console.warn('[Auto-Injector Error] Error evaluando inyección autónoma:', err);
    }
    return false;
  };

  // Función reutilizable de Rebalance de Grilla
  const performGridRebalance = async (newAtr: Decimal, targetPrice?: Decimal) => {
    if (circuitBreaker.getStatus().isTripped) {
      console.warn(`[Rebalance Suspended] 🛑 Re-ajuste por volatilidad ATR pausado temporalmente por Cortacircuitos activo.`);
      return;
    }

    const latestTicker = await exchangeAdapter.fetchTicker(symbol);
    const centerPrice = targetPrice ?? latestTicker.last;
    const highestGridLevel = gridManager.getConfig().upperPrice;

    // Evaluaciones de Bloqueo FOMO (Escudo Anti-Comprar la Cima de un Pump)
    const fomoCheck = fomoGuard.checkFomoRisk(centerPrice, highestGridLevel);
    if (fomoCheck.isBlocked) {
      console.warn(`[FomoGuard Trigger] 🛑 ${fomoCheck.message}`);
      return;
    }

    console.log(`\n[Rebalance Trigger] ⚡ Re-ajustando grilla en torno al precio $${centerPrice.toFixed(2)} USD (ATR: $${newAtr.toFixed(2)} USD)...`);

    // Obtener los costos de compra reales del inventario desde ejecuciones pasadas (FILLED)
    const filledOrders = await repository.getOrdersByStatus(OrderStatus.FILLED);
    const holdingCostBasis: Decimal[] = filledOrders
      .filter((o) => o.side === OrderSide.BUY)
      .map((o) => new Decimal(o.price));

    const currentOpenOrders = await repository.getOpenOrders();
    for (const ord of currentOpenOrders) {
      if (ord.exchangeId) {
        await exchangeAdapter.cancelOrder(ord.exchangeId, symbol);
        await repository.updateOrderStatusById(ord.id, OrderStatus.CANCELED);
      }
    }

    // Re-consultar saldos libres reales en Binance tras cancelar órdenes
    if (!env.DRY_RUN) {
      try {
        const bal = await exchangeAdapter.fetchBalance();
        liveUsdtFree = bal.free['USDT'] ? new Decimal(bal.free['USDT']) : undefined;
        liveBtcFree = bal.free['BTC'] ? new Decimal(bal.free['BTC']) : undefined;
        console.log(`[Rebalance Balance Refresh] 💰 Saldo libre actualizado post-cancelación: $${liveUsdtFree?.toFixed(2)} USDT | ${liveBtcFree?.toFixed(6)} BTC`);
      } catch (err) {
        console.warn('[Rebalance Balance Warning] Error al refrescar balance:', err);
      }
    }

    const rebalanced = gridManager.adjustToVolatility(
      newAtr,
      centerPrice,
      4.0,
      env.MIN_GRID_RANGE_USD.toNumber(),
      env.MAX_GRID_RANGE_USD.toNumber()
    );

    const newSeedPlans = gridManager.generateSeedOrders(centerPrice, holdingCostBasis, liveUsdtFree, liveBtcFree);
    for (const plan of newSeedPlans) {
      try {
        const createdOrder = await exchangeAdapter.createOrder({
          symbol,
          type: 'limit',
          side: plan.side,
          amount: plan.amount,
          price: plan.price,
        });

        await repository.upsertGridLevel(plan.levelIndex, plan.price, plan.side === 'sell');

        await repository.createOrderRecord({
          exchangeId: createdOrder.id,
          symbol: createdOrder.symbol,
          side: plan.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
          price: createdOrder.price,
          amount: createdOrder.amount,
          gridLevelId: plan.levelIndex,
          status: OrderStatus.OPEN,
        });
      } catch (err: any) {
        if (isInsufficientFundsError(err)) {
          console.warn(`[Rebalance Insufficient Funds Alert] 🚨 Binance rechazó orden re-sembrada por saldo insuficiente (-2010). Disparando Alerta de Sed...`);
          await checkAndExecuteAutoInjection(true);
        } else {
          console.error(`[Rebalance Order Error] Error al crear orden re-sembrada:`, err.message || err);
        }
      }
    }

    console.log(`[Rebalance Complete] ✨ Grilla Re-ajustada: Nuevo rango $${rebalanced.newLowerPrice.toFixed(2)} - $${rebalanced.newUpperPrice.toFixed(2)} USD (${newSeedPlans.length} órdenes re-sembradas con Inventory Cost Guard).\n`);
  };

  // Si DRY_RUN === false (Ejecución real en Binance Spot), conectar WebSocket privado watchOrders()
  let exchangeStreams: IExchangeStreams | null = null;
  if (!env.DRY_RUN && env.EXCHANGE_API_KEY && env.EXCHANGE_API_SECRET) {
    console.log(`[Live Mode] 🔴 MODO PRODUCCIÓN REAL ACTIVADO: Conectando a servicio de monitoreo de cuenta Binance...`);
    const liveStreams = new CcxtExchangeStreams(exchangeConfig);
    await liveStreams.initialize();
    await liveStreams.subscribeOrders(symbol);
    exchangeStreams = liveStreams;

    exchangeStreams.on('order:filled', (event) => {
      console.log(`[Live WS Order Stream] ⚡ Orden ejecutada en Binance en vivo: ${event.side.toUpperCase()} ${event.amount} @ $${event.price.toFixed(2)}`);
      systemBus.emit('ORDER_FILLED', event);
    });
  }

  // Listener para realizar el "Flip" cuando se reciba una notificación de orden ejecutada + Alertas a Slack en Tiempo Real
  systemBus.on('ORDER_FILLED', async (event) => {
    console.log(`[Flip Event Bus] ⚡ ORDER_FILLED recibida para Nivel ${event.gridLevel}. Generando contra-orden ("Flip")...`);

    // Notificación en vivo a Slack
    await notifier.notifyOrderExecution({
      side: event.side,
      symbol,
      amount: event.amount,
      price: event.price,
      gridLevel: event.gridLevel,
      feeCurrency: event.fee?.currency,
      feeCost: event.fee?.cost,
    });

    if (event.id) {
      await repository.updateOrderStatusByExchangeId(
        event.id,
        OrderStatus.FILLED,
        event.fee?.cost,
        event.fee?.currency,
        event.fee?.cost
      );
    }

    const flipPlan = gridManager.handleOrderFill(event);
    if (flipPlan) {
      // Si el cortacircuitos está activo y la contra-orden es una COMPRA, frenar
      if (flipPlan.side === 'buy' && circuitBreaker.getStatus().isTripped) {
        console.warn(`[CircuitBreaker] 🛑 Contra-orden de COMPRA (Flip) bloqueada por Cortacircuitos activo.`);
        return;
      }

      try {
        const createdFlip = await exchangeAdapter.createOrder({
          symbol,
          type: 'limit',
          side: flipPlan.side,
          amount: flipPlan.amount,
          price: flipPlan.price,
        });

        await repository.createOrderRecord({
          exchangeId: createdFlip.id,
          symbol: createdFlip.symbol,
          side: flipPlan.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
          price: createdFlip.price,
          amount: createdFlip.amount,
          gridLevelId: flipPlan.levelIndex,
          status: OrderStatus.OPEN,
        });

        await repository.upsertGridLevel(flipPlan.levelIndex, flipPlan.price, flipPlan.side === 'sell');

        console.log(`[Flip Executed] 🔄 Contra-orden ("Flip") ${flipPlan.side.toUpperCase()} colocada a $${flipPlan.price.toFixed(2)} USD (Nivel ${flipPlan.levelIndex})`);
      } catch (err: any) {
        if (isInsufficientFundsError(err)) {
          console.warn(`[Flip Insufficient Funds Alert] 🚨 Binance rechazó orden Flip por saldo insuficiente (-2010). Disparando Alerta de Sed e Inyección de Emergencia...`);
          await checkAndExecuteAutoInjection(true);
        } else {
          console.error(`[Flip Execution Error] Error al crear orden Flip:`, err.message || err);
        }
      }
    }
  });

  // 7. Registrar Tarea Programada de Cierre Diario (00:00 UTC)
  setupDailyReportCron(repository, notifier, () => {
    const config = gridManager.getConfig();
    return {
      atrValue: initialAtr.toNumber(),
      minGridRange: config.lowerPrice.toNumber(),
      maxGridRange: config.upperPrice.toNumber(),
      usdtBalance: 1000.0,
      btcBalance: 0.0022,
    };
  });

  // 8. Ejecutar Reconciliador / Bootstrapper al reiniciar
  const bootstrapper = new Bootstrapper(exchangeAdapter, repository, gridManager);
  const reconcileRes = await bootstrapper.reconcile(symbol);

  if (reconcileRes.hasInvertedOrders) {
    console.log('[Bootstrapper Inversion Auto-Fix] 🔄 Se detectaron órdenes invertidas. Forzando rebalance limpio de grilla...');
    await performGridRebalance(initialAtr, currentPrice);
  }

  // 9. Siembra Inicial de Órdenes si es una Grilla Nueva
  const openOrdersInDb = await repository.getOpenOrders();

  if (openOrdersInDb.length === 0) {
    console.log('[Seeding] Generando órdenes de siembra iniciales adaptadas al saldo físico disponible...');
    const seedPlans = gridManager.generateSeedOrders(currentPrice, [], liveUsdtFree, liveBtcFree);

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

      try {
        const createdOrder = await exchangeAdapter.createOrder({
          symbol,
          type: 'limit',
          side: plan.side,
          amount: plan.amount,
          price: plan.price,
        });

        await repository.upsertGridLevel(plan.levelIndex, plan.price, plan.side === 'sell');

        await repository.createOrderRecord({
          exchangeId: createdOrder.id,
          symbol: createdOrder.symbol,
          side: plan.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
          price: createdOrder.price,
          amount: createdOrder.amount,
          gridLevelId: plan.levelIndex,
          status: OrderStatus.OPEN,
        });

        console.log(`[Seeding Order] ✅ Orden límite colocada: ${plan.side.toUpperCase()} ${plan.amount} BTC @ $${plan.price.toFixed(2)} USD (Nivel ${plan.levelIndex})`);
      } catch (err: any) {
        if (isInsufficientFundsError(err)) {
          console.warn(`[Seeding Insufficient Funds Alert] 🚨 Binance rechazó orden de siembra (${plan.side.toUpperCase()} Nivel ${plan.levelIndex}) por saldo insuficiente (-2010).`);
        } else {
          console.error(`[Seeding Order Error] Error al crear orden de siembra:`, err.message || err);
        }
      }
    }

    console.log(`[Seeding] 🚀 Siembra inicial completada: ${seedPlans.length} órdenes límite de siembra intentadas.`);
  } else {
    for (const level of gridManager.getLevels()) {
      const activeOrder = openOrdersInDb.find((o) => o.gridLevelId === level.levelIndex);
      const isHolding = activeOrder ? activeOrder.side === OrderSide.SELL : false;
      await repository.upsertGridLevel(level.levelIndex, level.price, isHolding);
    }
  }

  volatilityEngine.on('VOLATILITY_CHANGE', async (newAtr: Decimal) => {
    await performGridRebalance(newAtr);
  });

  await volatilityEngine.start(symbol, env.ATR_TIMEFRAME, env.ATR_PERIOD);

  // 11. Bucle de Tickers de Mercado en Vivo con Monitoreo Periódico de Autodefensa, Cortacircuitos y Recentrado Out-of-Bounds
  console.log('====================================================');
  console.log('🟢 BOT OPERANDO EN TIEMPO REAL CON RECENTRADO DINÁMICO OUT-OF-BOUNDS');
  console.log('====================================================');

  let tickCount = 0;
  let lastOobRebalanceTime = 0;
  const OOB_REBALANCE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutos de cooldown entre recentrados por fuera de rango

  const tickerInterval = setInterval(async () => {
    try {
      const ticker = await exchangeAdapter.fetchTicker(symbol);
      tickCount++;

      // Evaluar la salud del mercado en el Cortacircuitos
      const healthCheck = circuitBreaker.checkMarketHealth(ticker.last);

      if (healthCheck.isTripped) {
        if (healthCheck.justTripped && healthCheck.message) {
          console.warn(`[CircuitBreaker Alert] ${healthCheck.message}`);

          // 1. Notificar a Slack inmediatamente
          await notifier.notifyOrderExecution({
            side: 'BUY',
            symbol,
            amount: 0,
            price: ticker.last,
            netProfitUsd: 0,
          });

          // 2. Cancelar proactivamente todas las órdenes LÍMITE DE COMPRA abiertas
          const currentOrders = await repository.getOpenOrders();
          for (const ord of currentOrders) {
            if (ord.side === OrderSide.BUY) {
              if (ord.exchangeId) {
                await exchangeAdapter.cancelOrder(ord.exchangeId, symbol);
              }
              await repository.updateOrderStatusById(ord.id, OrderStatus.CANCELED);
            }
          }
          console.log(`[CircuitBreaker] 🛑 Todas las órdenes de COMPRA canceladas proactivamente. Manteniendo órdenes de VENTA para rebotes rápidos.`);
        }

        // Si está en pausa, omitir procesamiento de compras y matching
        return;
      }

      if (env.DRY_RUN) {
        await matchingEngine.processLivePrice(ticker.last);
      }

      // Evaluar Autodefensa de Liquidez (Alerta de Sed) cada 30 ticks (~60 segundos)
      if (tickCount % 30 === 0) {
        await checkAndExecuteAutoInjection(false);
      }

      // MONITOREO DE BRECHAS ("NO MAN'S LAND GAP RECENTER GUARD")
      if (tickCount % 60 === 0 && !circuitBreaker.getStatus().isTripped && !fomoGuard.getStatus().isBlocked) {
        const openOrdersNow = await repository.getOpenOrders();
        let maxBuy = new Decimal(0);
        let minSell = new Decimal(999999);

        for (const ord of openOrdersNow) {
          const priceDec = new Decimal(ord.price);
          if (ord.side === OrderSide.BUY && priceDec.greaterThan(maxBuy)) {
            maxBuy = priceDec;
          }
          if (ord.side === OrderSide.SELL && priceDec.lessThan(minSell)) {
            minSell = priceDec;
          }
        }

        const stepSize = gridManager.getStepSize();
        if (maxBuy.greaterThan(0) && minSell.lessThan(999999)) {
          const gapSize = minSell.minus(maxBuy);
          if (gapSize.greaterThan(stepSize.times(2.5))) {
            console.warn(
              `[Gap Recenter Guard] ⚠️ Brecha excesiva detectada entre compra ($${maxBuy.toFixed(2)}) y venta ($${minSell.toFixed(2)}) (Brecha: $${gapSize.toFixed(2)} USD). Recentrando grilla sin borrar la base de datos...`
            );
            const currentAtr = volatilityEngine.getCurrentAtr() || initialAtr;
            await performGridRebalance(currentAtr, ticker.last);
          }
        }
      }

      // EVALUACIÓN DE OUT OF BOUNDS CON RECENTRADO AUTÓNOMO
      const isOutOfBounds = ticker.last.lessThan(gridManager.getConfig().lowerPrice) || ticker.last.greaterThan(gridManager.getConfig().upperPrice);
      if (isOutOfBounds) {
        console.warn(`[Market Alert] ⚠️ Precio actual ($${ticker.last.toFixed(2)}) fuera del rango ($${gridManager.getConfig().lowerPrice.toFixed(2)} - $${gridManager.getConfig().upperPrice.toFixed(2)})`);

        const now = Date.now();
        if (!circuitBreaker.getStatus().isTripped && !fomoGuard.getStatus().isBlocked && (now - lastOobRebalanceTime >= OOB_REBALANCE_COOLDOWN_MS)) {
          lastOobRebalanceTime = now;
          console.log(`[OOB Auto-Recenter] 🔄 Forzando recentrado dinámico de grilla alrededor de $${ticker.last.toFixed(2)} USD...`);
          const currentAtr = volatilityEngine.getCurrentAtr() || initialAtr;
          await performGridRebalance(currentAtr, ticker.last);
        }
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
    if (exchangeStreams) {
      await exchangeStreams.close();
    }
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
