import Decimal from 'decimal.js';
import { GridConfigInput } from '../config';
import { AtrCalculator } from '../core/atrCalculator';

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
  enableAtrVolatility?: boolean;
  atrPeriod?: number;
  atrMultiplier?: number;
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
  atrRebalanceEventsCount: number;

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

interface InventoryLot {
  buyPrice: Decimal;
  amount: Decimal;
}

export class GridBacktester {
  private config: GridConfigInput;
  private makerFeeRate: Decimal;
  private enableTrailingUp: boolean;
  private trailingUpThreshold: number;
  private enableTrailingDown: boolean;
  private stopLossPercent: Decimal;
  private trailingDownThreshold: number;
  private enableAtrVolatility: boolean;
  private atrPeriod: number;
  private atrMultiplier: number;

  constructor(config: GridConfigInput, options: BacktestOptions | Decimal | number = {}) {
    this.config = { ...config };

    if (options instanceof Decimal || typeof options === 'number') {
      this.makerFeeRate = new Decimal(options).dividedBy(100);
      this.enableTrailingUp = false;
      this.trailingUpThreshold = 4;
      this.enableTrailingDown = false;
      this.stopLossPercent = new Decimal(3);
      this.trailingDownThreshold = 4;
      this.enableAtrVolatility = false;
      this.atrPeriod = 14;
      this.atrMultiplier = 4.0;
    } else {
      this.makerFeeRate = new Decimal(options.makerFeePercent ?? 0.05).dividedBy(100);
      this.enableTrailingUp = options.enableTrailingUp ?? false;
      this.trailingUpThreshold = options.trailingUpThreshold ?? 4;
      this.enableTrailingDown = options.enableTrailingDown ?? false;
      this.stopLossPercent = new Decimal(options.stopLossPercent ?? 3);
      this.trailingDownThreshold = options.trailingDownThreshold ?? 4;
      this.enableAtrVolatility = options.enableAtrVolatility ?? false;
      this.atrPeriod = options.atrPeriod ?? 14;
      this.atrMultiplier = options.atrMultiplier ?? 4.0;
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
    let levels: SimulatedGridLevel[] = this.buildLevels(currentLower, stepSize, budgetPerLevel, startPrice, []);

    let totalFlipsCompleted = 0;
    let totalBuyOrdersFilled = 0;
    let totalSellOrdersFilled = 0;
    let trailingUpEventsCount = 0;
    let trailingDownEventsCount = 0;
    let atrRebalanceEventsCount = 0;
    let totalGrossProfitUsd = new Decimal(0);
    let totalFeesPaidUsd = new Decimal(0);
    let stopLossLossUsd = new Decimal(0);
    let outOfBoundsCandlesCount = 0;

    let consecutiveUpperBreaches = 0;
    let consecutiveLowerBreaches = 0;
    const windowCandles: OHLCV[] = [];
    const inventoryStack: InventoryLot[] = [];

    // Simular vela por vela
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const { high, low, close } = candle;
      windowCandles.push(candle);

      // 1. Check Volatilidad Adaptativa por ATR (Reajuste periódico o al salirse de rango)
      if (this.enableAtrVolatility && windowCandles.length >= this.atrPeriod + 1) {
        const isPeriodCheck = i % 1440 === 0 && i > 0;
        const isOutOfBounds = close.lessThan(currentLower) || close.greaterThan(currentUpper);

        if (isPeriodCheck || isOutOfBounds) {
          const recentCandles = windowCandles.slice(-60); // Última hora
          const atr = AtrCalculator.calculate(recentCandles, this.atrPeriod);
          const dynamicRange = AtrCalculator.calculateDynamicRange(atr, this.atrMultiplier, 1500, 6000);
          const halfRange = dynamicRange.dividedBy(2);

          currentLower = close.minus(halfRange);
          currentUpper = close.plus(halfRange);

          stepSize = currentUpper.minus(currentLower).dividedBy(this.config.gridLevels - 1);
          budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

          const holdingCostBasis = inventoryStack.map((lot) => lot.buyPrice);
          levels = this.buildLevels(currentLower, stepSize, budgetPerLevel, close, holdingCostBasis);
          atrRebalanceEventsCount++;
        }
      }

      // 2. Check Trailing Up (Re-centrado hacia arriba)
      if (this.enableTrailingUp && !this.enableAtrVolatility) {
        if (close.greaterThan(currentUpper)) {
          consecutiveUpperBreaches++;
          if (consecutiveUpperBreaches >= this.trailingUpThreshold) {
            const totalRange = currentUpper.minus(currentLower);
            const halfRange = totalRange.dividedBy(2);
            currentLower = close.minus(halfRange);
            currentUpper = close.plus(halfRange);

            stepSize = currentUpper.minus(currentLower).dividedBy(this.config.gridLevels - 1);
            budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

            const holdingCostBasis = inventoryStack.map((lot) => lot.buyPrice);
            levels = this.buildLevels(currentLower, stepSize, budgetPerLevel, close, holdingCostBasis);
            trailingUpEventsCount++;
            consecutiveUpperBreaches = 0;
          }
        } else {
          consecutiveUpperBreaches = 0;
        }
      }

      // 3. Check Trailing Down / Stop Loss
      if (this.enableTrailingDown && !this.enableAtrVolatility) {
        const stopLossMultiplier = new Decimal(1).minus(this.stopLossPercent.dividedBy(100));
        const stopLossTriggerPrice = currentLower.times(stopLossMultiplier);

        if (close.lessThan(stopLossTriggerPrice)) {
          consecutiveLowerBreaches++;
          if (consecutiveLowerBreaches >= this.trailingDownThreshold) {
            let heldBtcTotal = new Decimal(0);
            let btcCostUsd = new Decimal(0);

            for (const lot of inventoryStack) {
              heldBtcTotal = heldBtcTotal.plus(lot.amount);
              btcCostUsd = btcCostUsd.plus(lot.buyPrice.times(lot.amount));
            }

            if (heldBtcTotal.greaterThan(0)) {
              const liquidatedValueUsd = heldBtcTotal.times(close);
              const lossUsd = btcCostUsd.minus(liquidatedValueUsd);
              if (lossUsd.greaterThan(0)) {
                stopLossLossUsd = stopLossLossUsd.plus(lossUsd);
              }
              inventoryStack.length = 0; // Clear inventory after stop loss
            }

            const totalRange = currentUpper.minus(currentLower);
            const halfRange = totalRange.dividedBy(2);
            currentLower = close.minus(halfRange);
            currentUpper = close.plus(halfRange);

            stepSize = currentUpper.minus(currentLower).dividedBy(this.config.gridLevels - 1);
            budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

            levels = this.buildLevels(currentLower, stepSize, budgetPerLevel, close, []);
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
        if (level.hasBuyOrder && low.lessThanOrEqualTo(level.price)) {
          totalBuyOrdersFilled++;
          level.hasBuyOrder = false;

          const buyValueUsd = level.price.times(level.orderAmount);
          const buyFeeUsd = buyValueUsd.times(this.makerFeeRate);
          totalFeesPaidUsd = totalFeesPaidUsd.plus(buyFeeUsd);

          inventoryStack.push({
            buyPrice: level.price,
            amount: level.orderAmount,
          });

          const nextLevelIndex = level.levelIndex + 1;
          if (nextLevelIndex < levels.length) {
            levels[nextLevelIndex].hasSellOrder = true;
          }
        }

        if (level.hasSellOrder && high.greaterThanOrEqualTo(level.price)) {
          totalSellOrdersFilled++;
          level.hasSellOrder = false;

          const sellValueUsd = level.price.times(level.orderAmount);
          const sellFeeUsd = sellValueUsd.times(this.makerFeeRate);
          totalFeesPaidUsd = totalFeesPaidUsd.plus(sellFeeUsd);

          // FIFO Accounting de ganancia bruta
          let remainingToMatch = level.orderAmount;
          while (remainingToMatch.greaterThan(0) && inventoryStack.length > 0) {
            const lot = inventoryStack[0];
            const matchedAmount = Decimal.min(remainingToMatch, lot.amount);

            const spreadGross = level.price.minus(lot.buyPrice).times(matchedAmount);
            if (spreadGross.greaterThan(0)) {
              totalGrossProfitUsd = totalGrossProfitUsd.plus(spreadGross);
            } else {
              stopLossLossUsd = stopLossLossUsd.plus(spreadGross.abs());
            }

            lot.amount = lot.amount.minus(matchedAmount);
            remainingToMatch = remainingToMatch.minus(matchedAmount);

            if (lot.amount.lessThanOrEqualTo(0.000001)) {
              inventoryStack.shift();
            }
          }

          totalFlipsCompleted++;

          const prevLevelIndex = level.levelIndex - 1;
          if (prevLevelIndex >= 0) {
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
      atrRebalanceEventsCount,
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
    currentPrice: Decimal,
    holdingCostBasis: Decimal[]
  ): SimulatedGridLevel[] {
    const levels: SimulatedGridLevel[] = [];
    let minAllowedSellPrice = new Decimal(0);
    if (holdingCostBasis.length > 0) {
      const highestCost = Decimal.max(...holdingCostBasis);
      minAllowedSellPrice = highestCost.times(new Decimal(1.0015));
    }

    for (let i = 0; i < this.config.gridLevels; i++) {
      let price = lowerPrice.plus(stepSize.times(i));

      let hasBuy = price.lessThan(currentPrice);
      let hasSell = price.greaterThan(currentPrice);

      if (hasSell && holdingCostBasis.length > 0 && price.lessThan(minAllowedSellPrice)) {
        price = minAllowedSellPrice;
      }

      const amount = budgetPerLevel.dividedBy(price).toDecimalPlaces(6, Decimal.ROUND_DOWN);

      levels.push({
        levelIndex: i,
        price,
        hasBuyOrder: hasBuy,
        hasSellOrder: hasSell,
        orderAmount: amount,
      });
    }
    return levels;
  }
}
