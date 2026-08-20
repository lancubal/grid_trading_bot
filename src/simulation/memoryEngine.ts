import { CandleBuffer } from './datasetLoader';
import { FitnessCalculator, SimulationMetrics } from './fitness';

export interface BotHyperparameters {
  gridLevels: number;
  investment: number; // e.g. 10000
  atrPeriod: number;
  atrTimeframeMinutes: number; // default: 60 (1h)
  atrMultiplier: number;
  minGridRangeUsd: number;
  maxGridRangeUsd: number;
  priceDriftUpperThreshold: number;
  priceDriftLowerThreshold: number;
  priceDriftCooldownMins: number;
  circuitBreakerDropPct: number;
  circuitBreakerWindowMins: number;
  fomoCooldownHours: number;
  enableMonthlyCompounding?: boolean; // default: true
}

interface SimulatedOrder {
  id: number;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  levelIndex: number;
}

/**
 * Motor de Simulación en Memoria con Contabilidad Física Spot Estricta (1:1 con Binance Spot).
 * - Cero ventas a pérdida (el inventario en bóveda legacy queda bloqueado a su precio alto).
 * - Manejo riguroso de balances Free vs. Locked (USDT y BTC).
 * - Conservación absoluta de masa y capital.
 * - Micro-secuencia temporal intra-vela.
 * - Comisiones reales de 0.075% BNB.
 */
export class MemoryEngine {
  public static readonly FEE_RATE = 0.00075; // 0.075% con 25% de descuento BNB

  public static run(candles: CandleBuffer, params: BotHyperparameters): SimulationMetrics {
    const totalCandles = candles.length;
    if (totalCandles === 0) {
      throw new Error(`Buffer de velas vacío.`);
    }

    const durationDays = (candles.timestamps[totalCandles - 1] - candles.timestamps[0]) / (1000 * 60 * 60 * 24);
    const enableCompounding = params.enableMonthlyCompounding !== false;

    // 1. Estado de Balances Físicos en Binance Spot
    let activeInvestment = params.investment;
    let usdtFree = activeInvestment / 2;
    let usdtLocked = 0;

    const initialPrice = candles.opens[0];
    let btcFree = (activeInvestment / 2) / initialPrice;
    let btcLockedActive = 0;
    let btcLockedLegacy = 0;

    let initialEquity = usdtFree + btcFree * initialPrice;
    let peakEquity = initialEquity;
    let maxDrawdownPct = 0;

    let totalTrades = 0;
    let totalVolumeUsd = 0;
    let feesPaidUsd = 0;
    let orderIdCounter = 1;

    // Estado de Cortacircuitos, FOMO y Compounding
    let circuitBreakerTrippedUntil = 0;
    let fomoBlockedUntil = 0;
    let lastDriftRebalanceTime = 0;
    let lastCompoundingTimestamp = candles.timestamps[0];
    const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

    // Búfer para cálculo de ATR (Velas de 1h agregadas)
    const tfMins = params.atrTimeframeMinutes;
    const tfCandlesHighs: number[] = [];
    const tfCandlesLows: number[] = [];
    const tfCandlesCloses: number[] = [];

    let currentTfOpen = candles.opens[0];
    let currentTfHigh = candles.highs[0];
    let currentTfLow = candles.lows[0];
    let currentTfClose = candles.closes[0];
    let currentTfVolume = candles.volumes[0];
    let tfMinuteCount = 0;

    let currentAtr = Math.max(300, (candles.highs[0] - candles.lows[0]) * 10);

    // 2. Grilla y Órdenes Activas
    let currentGridLower = initialPrice - (params.minGridRangeUsd / 2);
    let currentGridUpper = initialPrice + (params.minGridRangeUsd / 2);
    let currentStepSize = (currentGridUpper - currentGridLower) / (params.gridLevels - 1);

    let activeOrders: SimulatedOrder[] = [];
    const legacyOrders: SimulatedOrder[] = [];

    /**
     * Siembra o Rebalancea la Grilla con Bloqueo Físico Estricto
     */
    const seedGridStrict = (centerPrice: number, atr: number) => {
      const rawRange = atr * params.atrMultiplier;
      const clampedRange = Math.max(params.minGridRangeUsd, Math.min(params.maxGridRangeUsd, rawRange));
      currentGridLower = centerPrice - (clampedRange / 2);
      currentGridUpper = centerPrice + (clampedRange / 2);
      currentStepSize = clampedRange / (params.gridLevels - 1);

      activeOrders = [];

      const buyLevels: { index: number; price: number }[] = [];
      const sellLevels: { index: number; price: number }[] = [];

      for (let i = 0; i < params.gridLevels; i++) {
        const levelPrice = currentGridLower + (i * currentStepSize);
        if (levelPrice < centerPrice * 0.9995) {
          buyLevels.push({ index: i, price: levelPrice });
        } else if (levelPrice > centerPrice * 1.0005) {
          sellLevels.push({ index: i, price: levelPrice });
        }
      }

      // 1. Distribuir USDT libre disponible bloqueándolo en órdenes de COMPRA
      if (buyLevels.length > 0 && usdtFree > 10) {
        const usdtPerBuy = usdtFree / buyLevels.length;
        for (const bl of buyLevels) {
          const amount = usdtPerBuy / bl.price;
          const cost = amount * bl.price;
          usdtFree -= cost;
          usdtLocked += cost;
          activeOrders.push({ id: orderIdCounter++, side: 'buy', price: bl.price, amount, levelIndex: bl.index });
        }
      }

      // 2. Distribuir BTC libre disponible bloqueándolo en órdenes de VENTA
      if (sellLevels.length > 0 && btcFree > 0.0001) {
        const btcPerSell = btcFree / sellLevels.length;
        for (const sl of sellLevels) {
          btcFree -= btcPerSell;
          btcLockedActive += btcPerSell;
          activeOrders.push({ id: orderIdCounter++, side: 'sell', price: sl.price, amount: btcPerSell, levelIndex: sl.index });
        }
      }
    };

    seedGridStrict(initialPrice, currentAtr);

    // 3. Bucle Principal de Velas de 1 minuto
    for (let t = 0; t < totalCandles; t++) {
      const time = candles.timestamps[t];
      const open = candles.opens[t];
      const high = candles.highs[t];
      const low = candles.lows[t];
      const close = candles.closes[t];
      const volume = candles.volumes[t];

      // A. Reinversión Mensual (Compounding)
      if (enableCompounding && time - lastCompoundingTimestamp >= MONTH_MS) {
        lastCompoundingTimestamp = time;
        const totalUsdtNow = usdtFree + usdtLocked;
        const totalBtcNow = btcFree + btcLockedActive + btcLockedLegacy;
        const currentTotalEquity = totalUsdtNow + (totalBtcNow * close);
        if (currentTotalEquity > activeInvestment) {
          activeInvestment = currentTotalEquity;
        }
      }

      // B. Agregación de Velas Superiores para ATR
      if (tfMinuteCount === 0) {
        currentTfOpen = open;
        currentTfHigh = high;
        currentTfLow = low;
      } else {
        if (high > currentTfHigh) currentTfHigh = high;
        if (low < currentTfLow) currentTfLow = low;
      }
      currentTfClose = close;
      currentTfVolume += volume;
      tfMinuteCount++;

      if (tfMinuteCount >= tfMins) {
        tfCandlesHighs.push(currentTfHigh);
        tfCandlesLows.push(currentTfLow);
        tfCandlesCloses.push(currentTfClose);
        tfMinuteCount = 0;

        if (tfCandlesCloses.length >= 2) {
          const count = Math.min(params.atrPeriod, tfCandlesCloses.length - 1);
          let sumTr = 0;
          const endIdx = tfCandlesCloses.length - 1;
          for (let k = 0; k < count; k++) {
            const idx = endIdx - k;
            const h = tfCandlesHighs[idx];
            const l = tfCandlesLows[idx];
            const prevC = tfCandlesCloses[idx - 1];
            const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
            sumTr += tr;
          }
          currentAtr = sumTr / count;
        }
      }

      // C. Evaluar Cortacircuitos (Velocity drop)
      if (t >= params.circuitBreakerWindowMins) {
        const pastClose = candles.closes[t - params.circuitBreakerWindowMins];
        const dropPct = ((pastClose - low) / pastClose) * 100;
        if (dropPct >= params.circuitBreakerDropPct && time > circuitBreakerTrippedUntil) {
          circuitBreakerTrippedUntil = time + (2 * 60 * 60 * 1000); // 2h cooldown
        }
      }
      const isCircuitBreakerActive = time < circuitBreakerTrippedUntil;

      // D. Evaluar FomoGuard (Peak breakout)
      if (high > currentGridUpper * 1.015 && time > fomoBlockedUntil) {
        fomoBlockedUntil = time + (params.fomoCooldownHours * 60 * 60 * 1000);
      }
      const isFomoBlocked = time < fomoBlockedUntil;

      // E. Micro-secuencia de Fills Intra-Vela
      const isGreenCandle = close >= open;

      const processBuyFills = () => {
        const remainingOrders: SimulatedOrder[] = [];
        for (const ord of activeOrders) {
          if (ord.side === 'buy' && low <= ord.price) {
            if (!isCircuitBreakerActive) {
              const cost = ord.amount * ord.price;
              const fee = cost * MemoryEngine.FEE_RATE;

              usdtLocked -= cost;
              usdtFree = Math.max(0, usdtFree - fee); // Comisión debitada
              feesPaidUsd += fee;
              totalVolumeUsd += cost;
              totalTrades++;

              // El BTC comprado se pasa inmediatamente a orden Flip SELL
              const flipPrice = ord.price + currentStepSize;
              btcLockedActive += ord.amount;
              remainingOrders.push({
                id: orderIdCounter++,
                side: 'sell',
                price: flipPrice,
                amount: ord.amount,
                levelIndex: ord.levelIndex + 1,
              });
            } else {
              remainingOrders.push(ord);
            }
          } else {
            remainingOrders.push(ord);
          }
        }
        activeOrders = remainingOrders;
      };

      const processSellFills = () => {
        const remainingOrders: SimulatedOrder[] = [];
        for (const ord of activeOrders) {
          if (ord.side === 'sell' && high >= ord.price) {
            const revenue = ord.amount * ord.price;
            const fee = revenue * MemoryEngine.FEE_RATE;

            btcLockedActive -= ord.amount;
            usdtFree += (revenue - fee);
            feesPaidUsd += fee;
            totalVolumeUsd += revenue;
            totalTrades++;

            // Generar contra-orden ("Flip") de COMPRA
            const flipPrice = ord.price - currentStepSize;
            const buyCost = ord.amount * flipPrice;

            if (!isCircuitBreakerActive && usdtFree >= buyCost) {
              usdtFree -= buyCost;
              usdtLocked += buyCost;
              remainingOrders.push({
                id: orderIdCounter++,
                side: 'buy',
                price: flipPrice,
                amount: ord.amount,
                levelIndex: ord.levelIndex - 1,
              });
            }
          } else {
            remainingOrders.push(ord);
          }
        }
        activeOrders = remainingOrders;
      };

      if (isGreenCandle) {
        processBuyFills();
        processSellFills();
      } else {
        processSellFills();
        processBuyFills();
      }

      // F. Evaluar Fills en Bóveda Legacy (Cero venta a pérdida: solo ejecuta a su precio original alto)
      for (let l = legacyOrders.length - 1; l >= 0; l--) {
        const legOrd = legacyOrders[l];
        if (high >= legOrd.price) {
          const rev = legOrd.amount * legOrd.price;
          const fee = rev * MemoryEngine.FEE_RATE;

          btcLockedLegacy -= legOrd.amount;
          usdtFree += (rev - fee);
          feesPaidUsd += fee;
          totalVolumeUsd += rev;
          totalTrades++;
          legacyOrders.splice(l, 1);
        }
      }

      // G. Recentrado Dinámico Out-of-Bounds & Price Drift
      const gridSpan = currentGridUpper - currentGridLower;
      if (gridSpan > 0 && !isCircuitBreakerActive && !isFomoBlocked) {
        const relativePosition = (close - currentGridLower) / gridSpan;
        const isOutOfRange = close < currentGridLower || close > currentGridUpper;
        const isDrifting = relativePosition >= params.priceDriftUpperThreshold || relativePosition <= params.priceDriftLowerThreshold;

        const cooldownMs = params.priceDriftCooldownMins * 60 * 1000;
        if ((isOutOfRange || isDrifting) && time - lastDriftRebalanceTime >= cooldownMs) {
          lastDriftRebalanceTime = time;

          // 1. Cancelar todas las compras abiertas liberando USDT locked ➔ free
          for (const ord of activeOrders) {
            if (ord.side === 'buy') {
              const cost = ord.amount * ord.price;
              usdtLocked -= cost;
              usdtFree += cost;
            }
          }

          // 2. Gestionar ventas abiertas:
          // Las que están por encima del mercado se archivan en Legacy (BTC queda bloqueado GTC en precio alto)
          // Las que están cerca o por debajo se cancelan liberando BTC locked ➔ free
          for (const ord of activeOrders) {
            if (ord.side === 'sell') {
              if (ord.price > close * 1.005) {
                btcLockedActive -= ord.amount;
                btcLockedLegacy += ord.amount;
                legacyOrders.push(ord);
              } else {
                btcLockedActive -= ord.amount;
                btcFree += ord.amount;
              }
            }
          }

          // 3. Re-sembrar la nueva grilla utilizando ÚNICAMENTE los saldos libres (usdtFree y btcFree)
          seedGridStrict(close, currentAtr);
        }
      }

      // H. Cálculo Exacto de Patrimonio Total (Equity) & Drawdown
      const totalUsdt = usdtFree + usdtLocked;
      const totalBtc = btcFree + btcLockedActive + btcLockedLegacy;
      const currentEquity = totalUsdt + (totalBtc * close);

      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const currentDd = ((peakEquity - currentEquity) / peakEquity) * 100;
      if (currentDd > maxDrawdownPct) {
        maxDrawdownPct = currentDd;
      }
    }

    const finalPrice = candles.closes[totalCandles - 1];
    const totalFinalUsdt = usdtFree + usdtLocked;
    const totalFinalBtc = btcFree + btcLockedActive + btcLockedLegacy;
    const finalEquity = totalFinalUsdt + (totalFinalBtc * finalPrice);

    return FitnessCalculator.evaluate(
      initialEquity,
      finalEquity,
      maxDrawdownPct,
      totalTrades,
      totalVolumeUsd,
      feesPaidUsd,
      totalFinalBtc,
      finalPrice,
      durationDays
    );
  }
}
