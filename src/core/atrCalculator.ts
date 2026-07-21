import Decimal from 'decimal.js';
import { OHLCV } from '../backtest/backtester';

export class AtrCalculator {
  /**
   * Calcula el Average True Range (ATR) para una serie de velas
   * @param candles Array de velas OHLCV
   * @param period Período del ATR (por defecto 14)
   */
  public static calculate(candles: OHLCV[], period: number = 14): Decimal {
    if (candles.length < period + 1) {
      // Fallback a la diferencia High-Low promedio si no hay suficientes velas
      if (candles.length === 0) return new Decimal(1000);
      const sumDiff = candles.reduce((acc, c) => acc.plus(c.high.minus(c.low)), new Decimal(0));
      return sumDiff.dividedBy(candles.length);
    }

    const trueRanges: Decimal[] = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];

      const highLow = current.high.minus(current.low);
      const highPrevClose = current.high.minus(previous.close).abs();
      const lowPrevClose = current.low.minus(previous.close).abs();

      const trueRange = Decimal.max(highLow, highPrevClose, lowPrevClose);
      trueRanges.push(trueRange);
    }

    // Tomar las últimas N entradas para el promedio
    const recentTr = trueRanges.slice(-period);
    const sumTr = recentTr.reduce((acc, val) => acc.plus(val), new Decimal(0));
    return sumTr.dividedBy(recentTr.length);
  }

  /**
   * Calcula el rango dinámico en USD sugerido para la grilla según la volatilidad del ATR
   * @param atr Valor del ATR
   * @param multiplier Multiplicador del ATR (por defecto 4.0 para cubrir fluctuaciones diarias)
   * @param minRange Rango mínimo permitido en USD (ej. $1,500 USD)
   * @param maxRange Rango máximo permitido en USD (ej. $6,000 USD)
   */
  public static calculateDynamicRange(
    atr: Decimal,
    multiplier: number = 4.0,
    minRange: Decimal | number = 1500,
    maxRange: Decimal | number = 6000
  ): Decimal {
    const rawRange = atr.times(multiplier);
    const minRangeDec = new Decimal(minRange);
    const maxRangeDec = new Decimal(maxRange);

    if (rawRange.lessThan(minRangeDec)) return minRangeDec;
    if (rawRange.greaterThan(maxRangeDec)) return maxRangeDec;

    return rawRange;
  }
}
