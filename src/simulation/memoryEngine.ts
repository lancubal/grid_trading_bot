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
  enableContinuousCompounding?: boolean; // default: true
}

interface SimulatedOrder {
  id: number;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  levelIndex: number;
}

/**
 * Motor de Simulación en Memoria de Alta Rentabilidad y Precisión Spot 1:1.
 * - Flips directos y fluidos (sin bloqueos artificiales).
 * - Dimensionamiento Ponderado por Proximidad (Mayor capital en zona de oscilación).
 * - Compounding Continuo en tiempo real.
 * - Cero ventas a pérdida (Bóveda Legacy protegida).
 * - Comisiones exactas al 0.075% BNB.
 */
export class MemoryEngine {
  public static readonly FEE_RATE = 0.00075; // 0.075% BNB discount fee rate

  public static run(candles: CandleBuffer, params: BotHyperparameters): SimulationMetrics {
    const totalCandles = candles.length;
    if (totalCandles === 0) {
      throw new Error(`Buffer de velas vacío.`);
    }

    const durationDays = (candles.timestamps[totalCandles - 1] - candles.timestamps[0]) / (1000 * 60 * 60 * 24);
    const enableCompounding = params.enableContinuousCompounding !== false;

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

    // Rastrear días activos con fills
    const activeDaysSet = new Set<number>();

    // Estado del Cortacircuitos y FOMO
    let circuitBreakerTrippedUntil = 0;
    let fomoBlockedUntil = 0;
    let lastDriftRebalanceTime = 0;

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
     * Siembra o Rebalancea la Grilla con Dimensionamiento Ponderado por Proximidad
     */
    const seedGridStrict = (centerPrice: number, atr: number) => {
      const rawRange = atr * params.atrMultiplier;
      const clampedRange = Math.max(params.minGridRangeUsd, Math.min(params.maxGridRangeUsd, rawRange));
      currentGridLower = centerPrice - (clampedRange / 2);
      currentGridUpper = centerPrice + (clampedRange / 2);
      currentStepSize = clampedRange / (params.gridLevels - 1);

      activeOrders = [];

      const buyLevels: { index: number; price: number; distance: number }[] = [];
      const sellLevels: { index: number; price: number; distance: number }[] = [];

      for (let i = 0; i < params.gridLevels; i++) {
        const levelPrice = currentGridLower + (i * currentStepSize);
        if (levelPrice < centerPrice * 0.9995) {
          buyLevels.push({ index: i, price: levelPrice, distance: Math.abs(centerPrice - levelPrice) });
        } else if (levelPrice > centerPrice * 1.0005) {
          sellLevels.push({ index: i, price: levelPrice, distance: Math.abs(levelPrice - centerPrice) });
        }
      }

      buyLevels.sort((a, b) => a.distance - b.distance);
      sellLevels.sort((a, b) => a.distance - b.distance);

      const baseOrderUsd = activeInvestment / (params.gridLevels - 1);

      // 1. Distribuir USDT libre en órdenes de compra
      for (let idx = 0; idx < buyLevels.length; idx++) {
        const bl = buyLevels[idx];
        const weightFactor = Math.max(0.85, 1.20 - (idx * 0.05));
        const targetOrderUsd = baseOrderUsd * weightFactor;

        if (usdtFree >= 5.0) {
          const orderCost = Math.min(targetOrderUsd, usdtFree);
          const amount = orderCost / bl.price;
          usdtFree -= orderCost;
          usdtLocked += orderCost;
          activeOrders.push({ id: orderIdCounter++, side: 'buy', price: bl.price, amount, levelIndex: bl.index });
        }
      }

      // 2. Distribuir BTC libre en órdenes de venta
      for (let idx = 0; idx < sellLevels.length; idx++) {
        const sl = sellLevels[idx];
        const weightFactor = Math.max(0.85, 1.20 - (idx * 0.05));
        const targetBtc = (baseOrderUsd * weightFactor) / sl.price;

        if (btcFree >= 0.0001) {
          const actualBtc = Math.min(targetBtc, btcFree);
          btcFree -= actualBtc;
          btcLockedActive += actualBtc;
          activeOrders.push({ id: orderIdCounter++, side: 'sell', price: sl.price, amount: actualBtc, levelIndex: sl.index });
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
      const dayIndex = Math.floor(time / (24 * 60 * 60 * 1000));

      // A. Agregación de Velas Superiores para ATR
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

      // B. Evaluar Cortacircuitos (Velocity drop)
      if (t >= params.circuitBreakerWindowMins) {
        const pastClose = candles.closes[t - params.circuitBreakerWindowMins];
        const dropPct = ((pastClose - low) / pastClose) * 100;
        if (dropPct >= params.circuitBreakerDropPct && time > circuitBreakerTrippedUntil) {
          circuitBreakerTrippedUntil = time + (2 * 60 * 60 * 1000); // 2h cooldown
        }
      }
      const isCircuitBreakerActive = time < circuitBreakerTrippedUntil;

      // C. Evaluar FomoGuard (Peak breakout)
      if (high > currentGridUpper * 1.015 && time > fomoBlockedUntil) {
        fomoBlockedUntil = time + (params.fomoCooldownHours * 60 * 60 * 1000);
      }
      const isFomoBlocked = time < fomoBlockedUntil;

      // D. Micro-secuencia de Fills Intra-Vela
      const isGreenCandle = close >= open;

      const processBuyFills = () => {
        const remainingOrders: SimulatedOrder[] = [];
        for (const ord of activeOrders) {
          if (ord.side === 'buy' && low <= ord.price) {
            if (!isCircuitBreakerActive) {
              const cost = ord.amount * ord.price;
              const fee = cost * MemoryEngine.FEE_RATE;

              usdtLocked -= cost;
              usdtFree = Math.max(0, usdtFree - fee);
              feesPaidUsd += fee;
              totalVolumeUsd += cost;
              totalTrades++;
              activeDaysSet.add(dayIndex);

              // El BTC comprado pasa a orden Flip SELL
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
            activeDaysSet.add(dayIndex);

            // Compounding Continuo: Actualizar inmediatamente el capital activo
            if (enableCompounding) {
              const currentTotalUsdt = usdtFree + usdtLocked;
              const currentTotalBtc = btcFree + btcLockedActive + btcLockedLegacy;
              const currentTotalEquity = currentTotalUsdt + (currentTotalBtc * close);
              if (currentTotalEquity > activeInvestment) {
                activeInvestment = currentTotalEquity;
              }
            }

            // Generar contra-orden ("Flip") de COMPRA con costo exacto directo
            const flipPrice = ord.price - currentStepSize;
            const flipBuyCost = ord.amount * flipPrice;

            if (!isCircuitBreakerActive && usdtFree >= flipBuyCost && flipBuyCost >= 5.0) {
              usdtFree -= flipBuyCost;
              usdtLocked += flipBuyCost;
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

      // E. Evaluar Fills en Bóveda Legacy (Cero venta a pérdida: solo ejecuta a su precio original alto)
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
          activeDaysSet.add(dayIndex);
          legacyOrders.splice(l, 1);

          if (enableCompounding) {
            const currentTotalUsdt = usdtFree + usdtLocked;
            const currentTotalBtc = btcFree + btcLockedActive + btcLockedLegacy;
            const currentTotalEquity = currentTotalUsdt + (currentTotalBtc * close);
            if (currentTotalEquity > activeInvestment) {
              activeInvestment = currentTotalEquity;
            }
          }
        }
      }

      // F. Recentrado Dinámico Out-of-Bounds & Price Drift
      const gridSpan = currentGridUpper - currentGridLower;
      if (gridSpan > 0 && !isCircuitBreakerActive && !isFomoBlocked) {
        const relativePosition = (close - currentGridLower) / gridSpan;
        const isOutOfRange = close < currentGridLower || close > currentGridUpper;
        const isDrifting = relativePosition >= params.priceDriftUpperThreshold || relativePosition <= params.priceDriftLowerThreshold;

        const cooldownMs = params.priceDriftCooldownMins * 60 * 1000;
        if ((isOutOfRange || isDrifting) && time - lastDriftRebalanceTime >= cooldownMs) {
          lastDriftRebalanceTime = time;

          // 1. Cancelar compras abiertas liberando USDT locked ➔ free
          for (const ord of activeOrders) {
            if (ord.side === 'buy') {
              const cost = ord.amount * ord.price;
              usdtLocked -= cost;
              usdtFree += cost;
            }
          }

          // 2. Archivar ventas superiores en Legacy / Cancelar ventas bajas
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

          // 3. Re-sembrar la nueva grilla
          seedGridStrict(close, currentAtr);
        }
      }

      // G. Cálculo Exacto de Patrimonio Total (Equity) & Drawdown
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
      durationDays,
      activeDaysSet.size
    );
  }
}
