import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { AtrCalculator } from './atrCalculator';
import { OHLCV } from '../backtest/backtester';

describe('AtrCalculator - Volatility Calculation Tests', () => {
  it('debe calcular correctamente el valor ATR de una serie de velas', () => {
    const candles: OHLCV[] = [];
    const basePrice = 64000;

    for (let i = 0; i < 20; i++) {
      candles.push({
        timestamp: Date.now() + i * 60000,
        open: new Decimal(basePrice),
        high: new Decimal(basePrice + 200),
        low: new Decimal(basePrice - 100),
        close: new Decimal(basePrice + 50),
        volume: new Decimal(10),
      });
    }

    const atr = AtrCalculator.calculate(candles, 14);
    expect(atr.greaterThan(0)).toBe(true);
    expect(atr.toString()).toBe('300'); // (200 - (-100)) = 300
  });

  it('debe ajustar el rango dinámico respetando los límites mínimo y máximo', () => {
    const lowAtr = new Decimal(200); // 200 * 4 = 800 (menor a min 1500)
    const highAtr = new Decimal(2000); // 2000 * 4 = 8000 (mayor a max 6000)

    const minClamped = AtrCalculator.calculateDynamicRange(lowAtr, 4.0, 1500, 6000);
    const maxClamped = AtrCalculator.calculateDynamicRange(highAtr, 4.0, 1500, 6000);

    expect(minClamped.toString()).toBe('1500');
    expect(maxClamped.toString()).toBe('6000');
  });
});
