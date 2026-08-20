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
  takeProfitMultiplier?: number; // default: 1.0 (1.0x a 2.0x del step)
  buyCapitalWeight?: number; // default: 0.50 (0.50 a 0.70 para grilla asimétrica)
}

interface SimulatedOrder {
  id: number;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  levelIndex: number;
}

/**
 * Motor de Simulación en Memoria con Grilla Asimétrica Alcista y Spot 1:1.
 * - Take-Profit Asimétrico: Permite multiplicar el salto de profit en ventas (1.0x a 2.0x).
 * - Ponderación Asimétrica de Capital: Asigna más peso a compras escalonadas (50% a 70%).
 * - Reinyección Inmediata de Liquidez Liberada de Bóveda Legacy.
 * - Ponderación Exponencial por Proximidad (1.35x en niveles centrales).
 * - Compounding Continuo en Ganancias Realizadas.
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
    const takeProfitMult = params.takeProfitMultiplier || 1.0;
    const buyCapWeight = params.buyCapitalWeight || 0.50;

    // 1. Estado de Balances Físicos en Binance Spot
    let activeInvestment = params.investment;
    let realizedNetProfitUsd = 0;

    let usdtFree = activeInvestment * buyCapWeight;
    let usdtLocked = 0;

    const initialPrice = candles.opens[0];
    let btcFree = (activeInvestment * (1.0 - buyCapWeight)) / initialPrice;
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
     * Siembra o Rebalancea la Grilla con Ponderación Asimétrica
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

      // 1. Distribuir USDT libre en órdenes de compra (Ponderación 1.35x en niveles centrales)
      for (let idx = 0; idx < buyLevels.length; idx++) {
        const bl = buyLevels[idx];
        const weightFactor = Math.max(0.75, 1.35 - (idx * 0.08));
        const targetOrderUsd = baseOrderUsd * weightFactor;

        if (usdtFree >= 5.0) {
          const orderCost = Math.min(targetOrderUsd, usdtFree);
          const amount = orderCost / bl.price;
          usdtFree -= orderCost;
          usdtLocked += orderCost;
          activeOrders.push({ id: orderIdCounter++, side: 'buy', price: bl.price, amount, levelIndex: bl.index });
        }
      }

      // 2. Distribuir BTC libre en órdenes de venta (Ponderación 1.35x en niveles centrales)
      for (let idx = 0; idx < sellLevels.length; idx++) {
        const sl = sellLevels[idx];
        const weightFactor = Math.max(0.75, 1.35 - (idx * 0.08));
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

              // El BTC comprado pasa a orden Flip SELL con Take-Profit Asimétrico
              const flipPrice = ord.price + (currentStepSize * takeProfitMult);
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

            // Compounding Realizado: beneficio neto expande activeInvestment
            if (enableCompounding) {
              const profitStep = (ord.amount * currentStepSize * takeProfitMult) - (fee * 2);
              if (profitStep > 0) {
                realizedNetProfitUsd += profitStep;
                activeInvestment = Math.max(params.investment, params.investment + realizedNetProfitUsd);
              }
            }

            // Generar contra-orden ("Flip") de COMPRA
            const flipPrice = ord.price - (currentStepSize * takeProfitMult);
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

      // E. Evaluar Fills en Bóveda Legacy & Reinyección Activa de Liquidez
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
            const netProfitOnLegacy = (legOrd.amount * currentStepSize) - (fee * 2);
            if (netProfitOnLegacy > 0) {
              realizedNetProfitUsd += netProfitOnLegacy;
              activeInvestment = Math.max(params.investment, params.investment + realizedNetProfitUsd);
            }
          }

          // Reinyección Activa Inmediata
          if (!isCircuitBreakerActive && usdtFree > 50) {
            const emptyBuyLevelPrice = close - currentStepSize;
            const targetBuyUsd = Math.min(usdtFree * 0.5, activeInvestment / (params.gridLevels - 1));
            if (targetBuyUsd >= 10) {
              const buyAmt = targetBuyUsd / emptyBuyLevelPrice;
              usdtFree -= targetBuyUsd;
              usdtLocked += targetBuyUsd;
              activeOrders.push({
                id: orderIdCounter++,
                side: 'buy',
                price: emptyBuyLevelPrice,
                amount: buyAmt,
                levelIndex: 0,
              });
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
