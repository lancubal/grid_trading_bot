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

  // Estrategia de Inyección Condicional por "Alerta de Sed"
  enableConditionalInjections?: boolean;
  injectionAmountUsd?: number; // Ej. $2,000 USD por inyección
  starvationThresholdUsd?: number; // Ej. $150 USDT de saldo disponible
  maxMonthlyInjectionsUsd?: number; // Ej. Máximo $2,000 USD por mes
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
  insufficientFundsEventsCount: number;

  // Estrategia "Alerta de Sed" (Inyecciones Condicionales)
  conditionalInjectionsCount: number;
  totalInjectedCapitalUsd: Decimal;
  totalInvestedCapitalUsd: Decimal;

  // Métricas Financieras Realizadas
  initialInvestmentUsd: Decimal;
  finalAvailableUsdtCash: Decimal;
  totalGrossProfitUsd: Decimal;
  totalFeesPaidUsd: Decimal;
  stopLossLossUsd: Decimal;
  netProfitUsd: Decimal;
  netRoiPercent: Decimal;

  // Inventario y Ganancia No Realizada (Floating PnL)
  heldBtcAmount: Decimal;
  heldBtcCostBasisUsd: Decimal;
  heldBtcMarketValueUsd: Decimal;
  unrealizedFloatingPnLUsd: Decimal;
  totalCombinedPortfolioValueUsd: Decimal;
  totalCombinedRoiPercent: Decimal;

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

  // Opciones de Inyección por Alerta de Sed
  private enableConditionalInjections: boolean;
  private injectionAmountUsd: Decimal;
  private starvationThresholdUsd: Decimal;
  private maxMonthlyInjectionsUsd: Decimal;

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
      this.enableConditionalInjections = false;
      this.injectionAmountUsd = new Decimal(2000);
      this.starvationThresholdUsd = new Decimal(150);
      this.maxMonthlyInjectionsUsd = new Decimal(2000);
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
      this.enableConditionalInjections = options.enableConditionalInjections ?? false;
      this.injectionAmountUsd = new Decimal(options.injectionAmountUsd ?? 2000);
      this.starvationThresholdUsd = new Decimal(options.starvationThresholdUsd ?? 150);
      this.maxMonthlyInjectionsUsd = new Decimal(options.maxMonthlyInjectionsUsd ?? 2000);
    }
  }

  /**
   * Ejecuta la simulación de Grid Trading sobre un conjunto de velas históricas OHLCV con control estricto de saldo USDT e inyección condicional
   */
  public run(candles: OHLCV[]): BacktestResult {
    if (candles.length === 0) {
      throw new Error('[Backtester Error] No se provieron velas históricas para la simulación.');
    }

    let availableUsdtCash = new Decimal(this.config.investment);
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
    let insufficientFundsEventsCount = 0;
    let conditionalInjectionsCount = 0;
    let totalInjectedCapitalUsd = new Decimal(0);
    let lastInjectionTimestamp = 0;

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
              // Devolver fondos liquidados al disponible USDT
              availableUsdtCash = availableUsdtCash.plus(liquidatedValueUsd);
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
          const buyValueUsd = level.price.times(level.orderAmount);
          const buyFeeUsd = buyValueUsd.times(this.makerFeeRate);
          const totalCostNeededUsd = buyValueUsd.plus(buyFeeUsd);

          // ESTRATEGIA "ALERTA DE SED": Si la liquidez cae por debajo del umbral, evaluar inyección condicional de capital
          if (
            this.enableConditionalInjections &&
            availableUsdtCash.lessThan(this.starvationThresholdUsd) &&
            availableUsdtCash.lessThan(totalCostNeededUsd)
          ) {
            const timeSinceLastInjectionMs = candle.timestamp - lastInjectionTimestamp;
            const isThirtyDaysPassed = lastInjectionTimestamp === 0 || timeSinceLastInjectionMs >= 30 * 24 * 3600 * 1000;

            if (isThirtyDaysPassed) {
              availableUsdtCash = availableUsdtCash.plus(this.injectionAmountUsd);
              totalInjectedCapitalUsd = totalInjectedCapitalUsd.plus(this.injectionAmountUsd);
              conditionalInjectionsCount++;
              lastInjectionTimestamp = candle.timestamp;

              console.log(
                `[Alerta de Sed Inyección] 💉 Inyección condicional de $${this.injectionAmountUsd.toFixed(2)} USD efectuada el ${new Date(candle.timestamp).toISOString().split('T')[0]} (Precio BTC: $${candle.close.toFixed(2)} USD)`
              );
            }
          }

          // CONTROL ESTRICTO DE SALDO DISPONIBLE EN USDT
          if (availableUsdtCash.greaterThanOrEqualTo(totalCostNeededUsd)) {
            availableUsdtCash = availableUsdtCash.minus(totalCostNeededUsd);
            totalBuyOrdersFilled++;
            level.hasBuyOrder = false;
            totalFeesPaidUsd = totalFeesPaidUsd.plus(buyFeeUsd);

            inventoryStack.push({
              buyPrice: level.price,
              amount: level.orderAmount,
            });

            const nextLevelIndex = level.levelIndex + 1;
            if (nextLevelIndex < levels.length) {
              levels[nextLevelIndex].hasSellOrder = true;
            }
          } else {
            // FONDOS INSUFICIENTES: Binance rechaza la orden ("Insufficient Funds")
            insufficientFundsEventsCount++;
          }
        }

        if (level.hasSellOrder && high.greaterThanOrEqualTo(level.price)) {
          const sellValueUsd = level.price.times(level.orderAmount);
          const sellFeeUsd = sellValueUsd.times(this.makerFeeRate);
          const netUsdtReturnedUsd = sellValueUsd.minus(sellFeeUsd);

          // Devolver el efectivo USDT cobrado por la venta al saldo disponible
          availableUsdtCash = availableUsdtCash.plus(netUsdtReturnedUsd);
          totalSellOrdersFilled++;
          level.hasSellOrder = false;
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

    const totalInvestedCapitalUsd = this.config.investment.plus(totalInjectedCapitalUsd);
    const netProfitUsd = totalGrossProfitUsd.minus(totalFeesPaidUsd).minus(stopLossLossUsd);
    const netRoiPercent = netProfitUsd.dividedBy(totalInvestedCapitalUsd).times(100);

    // Métricas de Inventario Retenido y Valoración No Realizada (Floating PnL)
    let heldBtcAmount = new Decimal(0);
    let heldBtcCostBasisUsd = new Decimal(0);
    for (const lot of inventoryStack) {
      heldBtcAmount = heldBtcAmount.plus(lot.amount);
      heldBtcCostBasisUsd = heldBtcCostBasisUsd.plus(lot.buyPrice.times(lot.amount));
    }
    const endPrice = candles[candles.length - 1].close;
    const heldBtcMarketValueUsd = heldBtcAmount.times(endPrice);
    const unrealizedFloatingPnLUsd = heldBtcMarketValueUsd.minus(heldBtcCostBasisUsd);

    const totalCombinedPortfolioValueUsd = availableUsdtCash.plus(heldBtcMarketValueUsd);
    const totalCombinedRoiPercent = totalCombinedPortfolioValueUsd.minus(totalInvestedCapitalUsd).dividedBy(totalInvestedCapitalUsd).times(100);

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
      insufficientFundsEventsCount,
      conditionalInjectionsCount,
      totalInjectedCapitalUsd,
      totalInvestedCapitalUsd,
      initialInvestmentUsd: this.config.investment,
      finalAvailableUsdtCash: availableUsdtCash,
      totalGrossProfitUsd,
      totalFeesPaidUsd,
      stopLossLossUsd,
      netProfitUsd,
      netRoiPercent,
      heldBtcAmount,
      heldBtcCostBasisUsd,
      heldBtcMarketValueUsd,
      unrealizedFloatingPnLUsd,
      totalCombinedPortfolioValueUsd,
      totalCombinedRoiPercent,
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
