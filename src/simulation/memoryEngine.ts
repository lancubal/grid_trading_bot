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
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  levelIndex: number;
}

/**
 * Motor de simulación en memoria de Alta Fidelidad (High-Fidelity Memory Engine).
 * - Contabilidad Spot estricta (cero inventario fantasma).
 * - Micro-secuencia intra-vela (O ➔ L ➔ H ➔ C / O ➔ H ➔ L ➔ C).
 * - Reinversión mensual de beneficios (Compounding).
 * - Comisiones exactas al 0.075% BNB.
 */
export class MemoryEngine {
  public static readonly FEE_RATE = 0.00075; // 0.075% BNB discount fee rate

  /**
   * Ejecuta la simulación determinista sobre el buffer de velas
   */
  public static run(candles: CandleBuffer, params: BotHyperparameters): SimulationMetrics {
    const totalCandles = candles.length;
    if (totalCandles === 0) {
      throw new Error(`Buffer de velas vacío.`);
    }

    const durationDays = (candles.timestamps[totalCandles - 1] - candles.timestamps[0]) / (1000 * 60 * 60 * 24);
    const enableCompounding = params.enableMonthlyCompounding !== false;

    // 1. Estado Inicial del Balance Físico en Binance Spot
    let activeInvestment = params.investment;
    let usdtFree = activeInvestment / 2;
    const initialPrice = candles.opens[0];
    let btcFree = (activeInvestment / 2) / initialPrice;
    let initialEquity = usdtFree + btcFree * initialPrice;
    let peakEquity = initialEquity;
    let maxDrawdownPct = 0;

    let totalTrades = 0;
    let totalVolumeUsd = 0;
    let feesPaidUsd = 0;

    // Estado del Cortacircuitos, FOMO y Compounding
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
     * Siembra o Rebalancea la Grilla con Contabilidad Spot Estricta
     * Solo coloca órdenes de compra si hay USDT libre, y órdenes de venta si hay BTC físico real.
     */
    const seedGridStrict = (centerPrice: number, atr: number) => {
      const rawRange = atr * params.atrMultiplier;
      const clampedRange = Math.max(params.minGridRangeUsd, Math.min(params.maxGridRangeUsd, rawRange));
      currentGridLower = centerPrice - (clampedRange / 2);
      currentGridUpper = centerPrice + (clampedRange / 2);
      currentStepSize = clampedRange / (params.gridLevels - 1);

      activeOrders = [];

      // Identificar niveles por debajo (compras) y por encima (ventas)
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

      // 1. Distribuir USDT libre disponible entre las órdenes de COMPRA
      if (buyLevels.length > 0 && usdtFree > 10) {
        const usdtPerBuy = usdtFree / buyLevels.length;
        for (const bl of buyLevels) {
          const amount = usdtPerBuy / bl.price;
          activeOrders.push({ side: 'buy', price: bl.price, amount, levelIndex: bl.index });
        }
      }

      // 2. Distribuir BTC libre disponible entre las órdenes de VENTA (Strict Spot Accounting)
      if (sellLevels.length > 0 && btcFree > 0.0001) {
        const btcPerSell = btcFree / sellLevels.length;
        for (const sl of sellLevels) {
          activeOrders.push({ side: 'sell', price: sl.price, amount: btcPerSell, levelIndex: sl.index });
        }
      }
    };

    seedGridStrict(initialPrice, currentAtr);

    // 3. Bucle Principal de Ticks de 1 minuto
    for (let t = 0; t < totalCandles; t++) {
      const time = candles.timestamps[t];
      const open = candles.opens[t];
      const high = candles.highs[t];
      const low = candles.lows[t];
      const close = candles.closes[t];
      const volume = candles.volumes[t];

      // A. Ciclo de Reinversión Mensual (Compounding)
      if (enableCompounding && time - lastCompoundingTimestamp >= MONTH_MS) {
        lastCompoundingTimestamp = time;
        const currentTotalEquity = usdtFree + (btcFree * close);
        if (currentTotalEquity > activeInvestment) {
          activeInvestment = currentTotalEquity; // Se reinvierten todas las ganancias acumuladas
        }
      }

      // B. Agregación de Velas de Timeframe Superior (ATR)
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

      // D. Evaluar FomoGuard (Peak Breakout)
      if (high > currentGridUpper * 1.015 && time > fomoBlockedUntil) {
        fomoBlockedUntil = time + (params.fomoCooldownHours * 60 * 60 * 1000);
      }
      const isFomoBlocked = time < fomoBlockedUntil;

      // E. Micro-secuencia Intra-Vela: Evaluar Fills en orden temporal realista
      const isGreenCandle = close >= open;

      const processBuyFills = () => {
        const remainingOrders: SimulatedOrder[] = [];
        for (const ord of activeOrders) {
          if (ord.side === 'buy' && low <= ord.price) {
            if (!isCircuitBreakerActive) {
              const cost = ord.amount * ord.price;
              const fee = cost * MemoryEngine.FEE_RATE;
              const totalRequired = cost + fee;

              if (usdtFree >= totalRequired) {
                usdtFree -= totalRequired;
                btcFree += ord.amount;
                feesPaidUsd += fee;
                totalVolumeUsd += cost;
                totalTrades++;

                // Generar contra-orden ("Flip") de VENTA
                const flipPrice = ord.price + currentStepSize;
                remainingOrders.push({
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
            if (btcFree >= ord.amount * 0.9999) { // Tolerancia de precisión float
              const actualBtc = Math.min(btcFree, ord.amount);
              const revenue = actualBtc * ord.price;
              const fee = revenue * MemoryEngine.FEE_RATE;

              btcFree -= actualBtc;
              usdtFree += (revenue - fee);
              feesPaidUsd += fee;
              totalVolumeUsd += revenue;
              totalTrades++;

              // Generar contra-orden ("Flip") de COMPRA
              const flipPrice = ord.price - currentStepSize;
              if (!isCircuitBreakerActive) {
                remainingOrders.push({
                  side: 'buy',
                  price: flipPrice,
                  amount: actualBtc,
                  levelIndex: ord.levelIndex - 1,
                });
              }
            } else {
              remainingOrders.push(ord);
            }
          } else {
            remainingOrders.push(ord);
          }
        }
        activeOrders = remainingOrders;
      };

      if (isGreenCandle) {
        // Vela Verde: O ➔ L (compras) ➔ H (ventas) ➔ C
        processBuyFills();
        processSellFills();
      } else {
        // Vela Roja: O ➔ H (ventas) ➔ L (compras) ➔ C
        processSellFills();
        processBuyFills();
      }

      // F. Evaluar Fills en Bóveda Legacy
      for (let l = legacyOrders.length - 1; l >= 0; l--) {
        const legOrd = legacyOrders[l];
        if (high >= legOrd.price && btcFree >= legOrd.amount * 0.999) {
          const actualBtc = Math.min(btcFree, legOrd.amount);
          const rev = actualBtc * legOrd.price;
          const fee = rev * MemoryEngine.FEE_RATE;

          btcFree -= actualBtc;
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

          // Archivar en bóveda legacy ventas que quedaron por encima
          for (const ord of activeOrders) {
            if (ord.side === 'sell' && ord.price > close * 1.005) {
              legacyOrders.push(ord);
            }
          }

          // Re-sembrar grilla en torno al nuevo precio con balance físico real
          seedGridStrict(close, currentAtr);
        }
      }

      // H. Monitoreo de Curva de Equity & Max Drawdown
      const currentEquity = usdtFree + (btcFree * close);
      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }
      const currentDd = ((peakEquity - currentEquity) / peakEquity) * 100;
      if (currentDd > maxDrawdownPct) {
        maxDrawdownPct = currentDd;
      }
    }

    const finalPrice = candles.closes[totalCandles - 1];
    const finalEquity = usdtFree + (btcFree * finalPrice);

    return FitnessCalculator.evaluate(
      initialEquity,
      finalEquity,
      maxDrawdownPct,
      totalTrades,
      totalVolumeUsd,
      feesPaidUsd,
      btcFree,
      finalPrice,
      durationDays
    );
  }
}
