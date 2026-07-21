import Decimal from 'decimal.js';
import { GridConfigInput } from '../config';

export interface OHLCV {
  timestamp: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
}

export interface BacktestOptions {
  makerFeePercent?: Decimal | number;
  enableTrailingUp?: boolean;
  trailingUpThreshold?: number;
  enableTrailingDown?: boolean;
  stopLossPercent?: Decimal | number;
  trailingDownThreshold?: number;
}

export interface BacktestResult {
  totalCandles: number;
  startDate: Date;
  endDate: Date;
  durationHours: number;

  // Estadísticas de Grid Trading
  totalFlipsCompleted: number;
  totalBuyOrdersFilled: number;
  totalSellOrdersFilled: number;
  trailingUpEventsCount: number;
  trailingDownEventsCount: number;

  // Métricas Financieras
  initialInvestmentUsd: Decimal;
  totalGrossProfitUsd: Decimal;
  totalFeesPaidUsd: Decimal;
  stopLossLossUsd: Decimal;
  netProfitUsd: Decimal;
  netRoiPercent: Decimal;

  // Tiempo Fuera de Rango (Out of Bounds)
  outOfBoundsCandlesCount: number;
  outOfBoundsHours: number;
  outOfBoundsPercent: Decimal;
}

interface SimulatedGridLevel {
  levelIndex: number;
  price: Decimal;
  hasBuyOrder: boolean;
  hasSellOrder: boolean;
  orderAmount: Decimal;
}

export class GridBacktester {
  private config: GridConfigInput;
  private makerFeeRate: Decimal;
  private enableTrailingUp: boolean;
  private trailingUpThreshold: number;
  private enableTrailingDown: boolean;
  private stopLossPercent: Decimal;
  private trailingDownThreshold: number;

  constructor(config: GridConfigInput, options: BacktestOptions | Decimal | number = {}) {
    this.config = { ...config };

    if (options instanceof Decimal || typeof options === 'number') {
      this.makerFeeRate = new Decimal(options).dividedBy(100);
      this.enableTrailingUp = false;
      this.trailingUpThreshold = 4;
      this.enableTrailingDown = false;
      this.stopLossPercent = new Decimal(3);
      this.trailingDownThreshold = 4;
    } else {
      this.makerFeeRate = new Decimal(options.makerFeePercent ?? 0.05).dividedBy(100);
      this.enableTrailingUp = options.enableTrailingUp ?? false;
      this.trailingUpThreshold = options.trailingUpThreshold ?? 4;
      this.enableTrailingDown = options.enableTrailingDown ?? false;
      this.stopLossPercent = new Decimal(options.stopLossPercent ?? 3);
      this.trailingDownThreshold = options.trailingDownThreshold ?? 4;
    }
  }

  /**
   * Ejecuta la simulación de Grid Trading sobre un conjunto de velas históricas OHLCV
   */
  public run(candles: OHLCV[]): BacktestResult {
    if (candles.length === 0) {
      throw new Error('[Backtester Error] No se provieron velas históricas para la simulación.');
    }

    let currentLower = new Decimal(this.config.lowerPrice);
    let currentUpper = new Decimal(this.config.upperPrice);
    let stepSize = currentUpper.minus(currentLower).dividedBy(this.config.gridLevels - 1);
    let budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

    const startPrice = candles[0].close;
    let levels: SimulatedGridLevel[] = this.buildLevels(currentLower, stepSize, budgetPerLevel, startPrice);

    let totalFlipsCompleted = 0;
    let totalBuyOrdersFilled = 0;
    let totalSellOrdersFilled = 0;
    let trailingUpEventsCount = 0;
    let trailingDownEventsCount = 0;
    let totalGrossProfitUsd = new Decimal(0);
    let totalFeesPaidUsd = new Decimal(0);
    let stopLossLossUsd = new Decimal(0);
    let outOfBoundsCandlesCount = 0;

    let consecutiveUpperBreaches = 0;
    let consecutiveLowerBreaches = 0;

    // Simular vela por vela
    for (const candle of candles) {
      const { high, low, close } = candle;

      // 1. Check Trailing Up (Re-centrado hacia arriba)
      if (this.enableTrailingUp) {
        if (close.greaterThan(currentUpper)) {
          consecutiveUpperBreaches++;
          if (consecutiveUpperBreaches >= this.trailingUpThreshold) {
            const totalRange = currentUpper.minus(currentLower);
            const halfRange = totalRange.dividedBy(2);
            currentLower = close.minus(halfRange);
            currentUpper = close.plus(halfRange);

            stepSize = currentUpper.minus(currentLower).dividedBy(this.config.gridLevels - 1);
            budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

            levels = this.buildLevels(currentLower, stepSize, budgetPerLevel, close);
            trailingUpEventsCount++;
            consecutiveUpperBreaches = 0;
          }
        } else {
          consecutiveUpperBreaches = 0;
        }
      }

      // 2. Check Trailing Down / Stop Loss (Re-centrado hacia abajo por quiebre de piso de 3%)
      if (this.enableTrailingDown) {
        const stopLossMultiplier = new Decimal(1).minus(this.stopLossPercent.dividedBy(100));
        const stopLossTriggerPrice = currentLower.times(stopLossMultiplier);

        if (close.lessThan(stopLossTriggerPrice)) {
          consecutiveLowerBreaches++;
          if (consecutiveLowerBreaches >= this.trailingDownThreshold) {
            // Calcular pérdida acumulada de BTC comprados durante la bajada y liquidados a Stop-Loss
            let heldBtcTotal = new Decimal(0);
            let btcCostUsd = new Decimal(0);

            for (const lvl of levels) {
              if (!lvl.hasBuyOrder) {
                heldBtcTotal = heldBtcTotal.plus(lvl.orderAmount);
                btcCostUsd = btcCostUsd.plus(lvl.price.times(lvl.orderAmount));
              }
            }

            if (heldBtcTotal.greaterThan(0)) {
              const liquidatedValueUsd = heldBtcTotal.times(close);
              const lossUsd = btcCostUsd.minus(liquidatedValueUsd);
              if (lossUsd.greaterThan(0)) {
                stopLossLossUsd = stopLossLossUsd.plus(lossUsd);
              }
            }

            // Re-centrar grilla abajo en el nuevo precio
            const totalRange = currentUpper.minus(currentLower);
            const halfRange = totalRange.dividedBy(2);
            currentLower = close.minus(halfRange);
            currentUpper = close.plus(halfRange);

            stepSize = currentUpper.minus(currentLower).dividedBy(this.config.gridLevels - 1);
            budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

            levels = this.buildLevels(currentLower, stepSize, budgetPerLevel, close);
            trailingDownEventsCount++;
            consecutiveLowerBreaches = 0;
          }
        } else {
          consecutiveLowerBreaches = 0;
        }
      }

      // Evaluar Out of Bounds
      if (high.lessThan(currentLower) || low.greaterThan(currentUpper)) {
        outOfBoundsCandlesCount++;
      }

      // Evaluar ejecuciones en los niveles de la grilla
      for (const level of levels) {
        // Ejecutar orden de COMPRA
        if (level.hasBuyOrder && low.lessThanOrEqualTo(level.price)) {
          totalBuyOrdersFilled++;
          level.hasBuyOrder = false;

          const buyValueUsd = level.price.times(level.orderAmount);
          const buyFeeUsd = buyValueUsd.times(this.makerFeeRate);
          totalFeesPaidUsd = totalFeesPaidUsd.plus(buyFeeUsd);

          const nextLevelIndex = level.levelIndex + 1;
          if (nextLevelIndex < levels.length) {
            levels[nextLevelIndex].hasSellOrder = true;
          }
        }

        // Ejecutar orden de VENTA
        if (level.hasSellOrder && high.greaterThanOrEqualTo(level.price)) {
          totalSellOrdersFilled++;
          level.hasSellOrder = false;

          const sellValueUsd = level.price.times(level.orderAmount);
          const sellFeeUsd = sellValueUsd.times(this.makerFeeRate);
          totalFeesPaidUsd = totalFeesPaidUsd.plus(sellFeeUsd);

          const prevLevelIndex = level.levelIndex - 1;
          if (prevLevelIndex >= 0) {
            const prevPrice = levels[prevLevelIndex].price;
            const grossGainPerCoin = level.price.minus(prevPrice);
            const cycleGrossProfit = grossGainPerCoin.times(level.orderAmount);

            totalGrossProfitUsd = totalGrossProfitUsd.plus(cycleGrossProfit);
            totalFlipsCompleted++;

            levels[prevLevelIndex].hasBuyOrder = true;
          }
        }
      }
    }

    const netProfitUsd = totalGrossProfitUsd.minus(totalFeesPaidUsd).minus(stopLossLossUsd);
    const netRoiPercent = netProfitUsd.dividedBy(this.config.investment).times(100);

    const startDate = new Date(candles[0].timestamp);
    const endDate = new Date(candles[candles.length - 1].timestamp);
    const durationHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);

    const outOfBoundsHours = outOfBoundsCandlesCount / 60;
    const outOfBoundsPercent = new Decimal(outOfBoundsCandlesCount)
      .dividedBy(candles.length)
      .times(100);

    return {
      totalCandles: candles.length,
      startDate,
      endDate,
      durationHours: parseFloat(durationHours.toFixed(2)),
      totalFlipsCompleted,
      totalBuyOrdersFilled,
      totalSellOrdersFilled,
      trailingUpEventsCount,
      trailingDownEventsCount,
      initialInvestmentUsd: this.config.investment,
      totalGrossProfitUsd,
      totalFeesPaidUsd,
      stopLossLossUsd,
      netProfitUsd,
      netRoiPercent,
      outOfBoundsCandlesCount,
      outOfBoundsHours: parseFloat(outOfBoundsHours.toFixed(2)),
      outOfBoundsPercent,
    };
  }

  private buildLevels(
    lowerPrice: Decimal,
    stepSize: Decimal,
    budgetPerLevel: Decimal,
    currentPrice: Decimal
  ): SimulatedGridLevel[] {
    const levels: SimulatedGridLevel[] = [];
    for (let i = 0; i < this.config.gridLevels; i++) {
      const price = lowerPrice.plus(stepSize.times(i));
      const amount = budgetPerLevel.dividedBy(price).toDecimalPlaces(6, Decimal.ROUND_DOWN);

      levels.push({
        levelIndex: i,
        price,
        hasBuyOrder: price.lessThan(currentPrice),
        hasSellOrder: price.greaterThan(currentPrice),
        orderAmount: amount,
      });
    }
    return levels;
  }
}
