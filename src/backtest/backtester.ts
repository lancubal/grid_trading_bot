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

export interface BacktestResult {
  totalCandles: number;
  startDate: Date;
  endDate: Date;
  durationHours: number;

  // Estadísticas de Grid Trading
  totalFlipsCompleted: number;
  totalBuyOrdersFilled: number;
  totalSellOrdersFilled: number;

  // Métricas Financieras
  initialInvestmentUsd: Decimal;
  totalGrossProfitUsd: Decimal;
  totalFeesPaidUsd: Decimal;
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

  constructor(config: GridConfigInput, makerFeePercent: Decimal | number = new Decimal('0.05')) {
    this.config = config;
    this.makerFeeRate = new Decimal(makerFeePercent).dividedBy(100); // 0.05% -> 0.0005
  }

  /**
   * Ejecuta la simulación de Grid Trading sobre un conjunto de velas históricas OHLCV
   */
  public run(candles: OHLCV[]): BacktestResult {
    if (candles.length === 0) {
      throw new Error('[Backtester Error] No se provieron velas históricas para la simulación.');
    }

    const stepSize = this.config.upperPrice.minus(this.config.lowerPrice).dividedBy(this.config.gridLevels - 1);
    const budgetPerLevel = this.config.investment.dividedBy(this.config.gridLevels - 1);

    // Inicializar niveles simulados con precio inicial de la primera vela
    const startPrice = candles[0].close;
    const levels: SimulatedGridLevel[] = [];

    for (let i = 0; i < this.config.gridLevels; i++) {
      const price = this.config.lowerPrice.plus(stepSize.times(i));
      const amount = budgetPerLevel.dividedBy(price).toDecimalPlaces(6, Decimal.ROUND_DOWN);

      levels.push({
        levelIndex: i,
        price,
        hasBuyOrder: price.lessThan(startPrice),
        hasSellOrder: price.greaterThan(startPrice),
        orderAmount: amount,
      });
    }

    let totalFlipsCompleted = 0;
    let totalBuyOrdersFilled = 0;
    let totalSellOrdersFilled = 0;
    let totalGrossProfitUsd = new Decimal(0);
    let totalFeesPaidUsd = new Decimal(0);
    let outOfBoundsCandlesCount = 0;

    // Simular vela por vela
    for (const candle of candles) {
      const { high, low } = candle;

      // Evaluar Out of Bounds
      if (high.lessThan(this.config.lowerPrice) || low.greaterThan(this.config.upperPrice)) {
        outOfBoundsCandlesCount++;
      }

      // Evaluar ejecuciones en los niveles de la grilla
      for (const level of levels) {
        // 1. Ejecutar orden de COMPRA si el Low de la vela toca o cae por debajo del nivel
        if (level.hasBuyOrder && low.lessThanOrEqualTo(level.price)) {
          totalBuyOrdersFilled++;
          level.hasBuyOrder = false;

          // Fee de compra
          const buyValueUsd = level.price.times(level.orderAmount);
          const buyFeeUsd = buyValueUsd.times(this.makerFeeRate);
          totalFeesPaidUsd = totalFeesPaidUsd.plus(buyFeeUsd);

          // Colocar contra-orden (VENTA) en nivel N+1
          const nextLevelIndex = level.levelIndex + 1;
          if (nextLevelIndex < levels.length) {
            levels[nextLevelIndex].hasSellOrder = true;
          }
        }

        // 2. Ejecutar orden de VENTA si el High de la vela toca o supera el nivel
        if (level.hasSellOrder && high.greaterThanOrEqualTo(level.price)) {
          totalSellOrdersFilled++;
          level.hasSellOrder = false;

          // Fee de venta y ganancia bruta
          const sellValueUsd = level.price.times(level.orderAmount);
          const sellFeeUsd = sellValueUsd.times(this.makerFeeRate);
          totalFeesPaidUsd = totalFeesPaidUsd.plus(sellFeeUsd);

          // Si vino de una compra en el nivel inferior, se completa un FLIP
          const prevLevelIndex = level.levelIndex - 1;
          if (prevLevelIndex >= 0) {
            const prevPrice = levels[prevLevelIndex].price;
            const grossGainPerCoin = level.price.minus(prevPrice);
            const cycleGrossProfit = grossGainPerCoin.times(level.orderAmount);

            totalGrossProfitUsd = totalGrossProfitUsd.plus(cycleGrossProfit);
            totalFlipsCompleted++;

            // Reactivar orden de COMPRA en el nivel inferior N-1
            levels[prevLevelIndex].hasBuyOrder = true;
          }
        }
      }
    }

    const netProfitUsd = totalGrossProfitUsd.minus(totalFeesPaidUsd);
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
      initialInvestmentUsd: this.config.investment,
      totalGrossProfitUsd,
      totalFeesPaidUsd,
      netProfitUsd,
      netRoiPercent,
      outOfBoundsCandlesCount,
      outOfBoundsHours: parseFloat(outOfBoundsHours.toFixed(2)),
      outOfBoundsPercent,
    };
  }
}
