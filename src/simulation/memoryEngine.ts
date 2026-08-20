import { CandleBuffer } from './datasetLoader';
import { FitnessCalculator, SimulationMetrics } from './fitness';

export interface BotHyperparameters {
  gridLevels: number;
  investment: number;
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
}

interface SimulatedOrder {
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  levelIndex: number;
}

/**
 * Motor de simulación en memoria ultra-rápido (Headless Memory Engine).
 * Evalúa cientos de miles de velas de 1m en milisegundos con cero asignaciones pesadas.
 */
export class MemoryEngine {
  private static readonly FEE_RATE = 0.00075; // 0.075% BNB discount fee rate

  /**
   * Ejecuta la simulación determinista sobre el buffer de velas
   */
  public static run(candles: CandleBuffer, params: BotHyperparameters): SimulationMetrics {
    const totalCandles = candles.length;
    if (totalCandles === 0) {
      throw new Error(`Buffer de velas vacío.`);
    }

    const durationDays = (candles.timestamps[totalCandles - 1] - candles.timestamps[0]) / (1000 * 60 * 60 * 24);

    // 1. Estado Inicial del Bot
    let usdtFree = params.investment / 2;
    const initialPrice = candles.opens[0];
    let btcFree = (params.investment / 2) / initialPrice;
    let initialEquity = usdtFree + btcFree * initialPrice;
    let peakEquity = initialEquity;
    let maxDrawdownPct = 0;

    let totalTrades = 0;
    let totalVolumeUsd = 0;
    let feesPaidUsd = 0;

    // Estado del Cortacircuitos y FOMO
    let circuitBreakerTrippedUntil = 0;
    let fomoBlockedUntil = 0;
    let lastDriftRebalanceTime = 0;

    // Búfer circular para cálculo de ATR (Velas de 1h agregadas)
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

    // Pre-calcular primer ATR inicial estimado
    let currentAtr = (candles.highs[0] - candles.lows[0]) * 10;
    if (currentAtr < 200) currentAtr = 400;

    // 2. Grilla y Órdenes Activas
    let currentGridLower = initialPrice - (params.minGridRangeUsd / 2);
    let currentGridUpper = initialPrice + (params.minGridRangeUsd / 2);
    let currentStepSize = (currentGridUpper - currentGridLower) / (params.gridLevels - 1);

    let activeOrders: SimulatedOrder[] = [];
    const legacyOrders: SimulatedOrder[] = [];

    // Función auxiliar para sembrar grilla
    const seedGrid = (centerPrice: number, atr: number) => {
      // Ajustar rango por ATR
      const rawRange = atr * params.atrMultiplier;
      const clampedRange = Math.max(params.minGridRangeUsd, Math.min(params.maxGridRangeUsd, rawRange));
      currentGridLower = centerPrice - (clampedRange / 2);
      currentGridUpper = centerPrice + (clampedRange / 2);
      currentStepSize = clampedRange / (params.gridLevels - 1);

      activeOrders = [];
      const orderValue = params.investment / (params.gridLevels - 1);

      for (let i = 0; i < params.gridLevels; i++) {
        const levelPrice = currentGridLower + (i * currentStepSize);
        if (levelPrice < centerPrice * 0.999) {
          // Orden de COMPRA
          const amount = orderValue / levelPrice;
          activeOrders.push({ side: 'buy', price: levelPrice, amount, levelIndex: i });
        } else if (levelPrice > centerPrice * 1.001) {
          // Orden de VENTA
          const amount = orderValue / levelPrice;
          activeOrders.push({ side: 'sell', price: levelPrice, amount, levelIndex: i });
        }
      }
    };

    seedGrid(initialPrice, currentAtr);

    // 3. Bucle Principal de Ticks (Velas de 1 minuto)
    for (let t = 0; t < totalCandles; t++) {
      const time = candles.timestamps[t];
      const open = candles.opens[t];
      const high = candles.highs[t];
      const low = candles.lows[t];
      const close = candles.closes[t];
      const volume = candles.volumes[t];

      // Actualizar agregación de vela de 1h
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

      // Cierre de vela de 1h -> Calcular ATR
      if (tfMinuteCount >= tfMins) {
        tfCandlesHighs.push(currentTfHigh);
        tfCandlesLows.push(currentTfLow);
        tfCandlesCloses.push(currentTfClose);
        tfMinuteCount = 0;

        if (tfCandlesCloses.length >= params.atrPeriod + 1) {
          let sumTr = 0;
          const endIdx = tfCandlesCloses.length - 1;
          for (let k = 0; k < params.atrPeriod; k++) {
            const idx = endIdx - k;
            const h = tfCandlesHighs[idx];
            const l = tfCandlesLows[idx];
            const prevC = tfCandlesCloses[idx - 1];
            const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
            sumTr += tr;
          }
          currentAtr = sumTr / params.atrPeriod;
        }
      }

      // Evaluar Cortacircuitos (Drop velocity)
      if (t >= params.circuitBreakerWindowMins) {
        const pastClose = candles.closes[t - params.circuitBreakerWindowMins];
        const dropPct = ((pastClose - low) / pastClose) * 100;
        if (dropPct >= params.circuitBreakerDropPct && time > circuitBreakerTrippedUntil) {
          circuitBreakerTrippedUntil = time + (2 * 60 * 60 * 1000); // 2h cooldown
        }
      }

      const isCircuitBreakerActive = time < circuitBreakerTrippedUntil;

      // Evaluar FomoGuard (Peak breakout)
      if (high > currentGridUpper * 1.015 && time > fomoBlockedUntil) {
        fomoBlockedUntil = time + (params.fomoCooldownHours * 60 * 60 * 1000);
      }
      const isFomoBlocked = time < fomoBlockedUntil;

      // 4. Matching Engine Local: Evaluar Fills en la vela actual [low, high]
      const newOrders: SimulatedOrder[] = [];
      for (const ord of activeOrders) {
        if (ord.side === 'buy') {
          // Si el precio cayó hasta el precio de compra y cortacircuitos no lo frenó
          if (low <= ord.price) {
            if (!isCircuitBreakerActive) {
              // Fill de COMPRA
              const cost = ord.amount * ord.price;
              const fee = cost * MemoryEngine.FEE_RATE;
              if (usdtFree >= cost) {
                usdtFree -= cost;
                btcFree += ord.amount;
                feesPaidUsd += fee;
                totalVolumeUsd += cost;
                totalTrades++;

                // Generar contra-orden ("Flip") de VENTA
                const flipPrice = ord.price + currentStepSize;
                newOrders.push({
                  side: 'sell',
                  price: flipPrice,
                  amount: ord.amount,
                  levelIndex: ord.levelIndex + 1,
                });
              } else {
                newOrders.push(ord); // Mantener abierta si no hay saldo
              }
            } else {
              newOrders.push(ord);
            }
          } else {
            newOrders.push(ord);
          }
        } else {
          // Orden de VENTA: Si el precio subió hasta el precio de venta
          if (high >= ord.price) {
            // Fill de VENTA
            const revenue = ord.amount * ord.price;
            const fee = revenue * MemoryEngine.FEE_RATE;
            if (btcFree >= ord.amount) {
              btcFree -= ord.amount;
              usdtFree += (revenue - fee);
              feesPaidUsd += fee;
              totalVolumeUsd += revenue;
              totalTrades++;

              // Generar contra-orden ("Flip") de COMPRA
              const flipPrice = ord.price - currentStepSize;
              if (!isCircuitBreakerActive) {
                newOrders.push({
                  side: 'buy',
                  price: flipPrice,
                  amount: ord.amount,
                  levelIndex: ord.levelIndex - 1,
                });
              }
            } else {
              newOrders.push(ord);
            }
          } else {
            newOrders.push(ord);
          }
        }
      }
      activeOrders = newOrders;

      // 5. Evaluar Órdenes en la Bóveda Legacy
      for (let l = legacyOrders.length - 1; l >= 0; l--) {
        const legOrd = legacyOrders[l];
        if (high >= legOrd.price) {
          const rev = legOrd.amount * legOrd.price;
          const fee = rev * MemoryEngine.FEE_RATE;
          btcFree = Math.max(0, btcFree - legOrd.amount);
          usdtFree += (rev - fee);
          feesPaidUsd += fee;
          totalVolumeUsd += rev;
          totalTrades++;
          legacyOrders.splice(l, 1);
        }
      }

      // 6. Recentrado Dinámico Out-of-Bounds & Price Drift
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

          // Re-sembrar grilla en torno al nuevo precio
          seedGrid(close, currentAtr);
        }
      }

      // 7. Trackear Curva de Equity & Max Drawdown
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
