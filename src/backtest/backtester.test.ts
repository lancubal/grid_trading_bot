import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { GridBacktester, OHLCV } from './backtester';
import { GridConfigInput } from '../config';

describe('GridBacktester - Historical Backtesting Simulation Tests', () => {
  const gridConfig: GridConfigInput = {
    symbol: 'BTC/USDT',
    lowerPrice: new Decimal('60000.00'),
    upperPrice: new Decimal('65000.00'),
    gridLevels: 6, // 60k, 61k, 62k, 63k, 64k, 65k (paso de 1k)
    investment: new Decimal('5000.00'),
  };

  it('debe simular ejecuciones de compras, ventas y calcular el beneficio neto restando comisiones Maker', () => {
    const backtester = new GridBacktester(gridConfig, 0.05);

    const now = Date.now();
    // Simular oscilaciones de precio entre 60k y 65k
    const mockCandles: OHLCV[] = [
      {
        timestamp: now,
        open: new Decimal('62500'),
        high: new Decimal('62600'),
        low: new Decimal('60900'), // Toca nivel 61k (COMPRA)
        close: new Decimal('61500'),
        volume: new Decimal('1'),
      },
      {
        timestamp: now + 60000,
        open: new Decimal('61500'),
        high: new Decimal('62100'), // Toca nivel 62k (VENTA - FLIP)
        low: new Decimal('61400'),
        close: new Decimal('62000'),
        volume: new Decimal('1'),
      },
    ];

    const result = backtester.run(mockCandles);

    expect(result.totalCandles).toBe(2);
    expect(result.totalBuyOrdersFilled).toBeGreaterThan(0);
    expect(result.totalSellOrdersFilled).toBeGreaterThan(0);
    expect(result.totalFlipsCompleted).toBe(1);
    expect(result.netProfitUsd.greaterThan(0)).toBe(true);
  });

  it('debe calcular correctamente el tiempo inactivo cuando el precio está fuera de rango (Out of Bounds)', () => {
    const backtester = new GridBacktester(gridConfig, 0.05);
    const now = Date.now();

    // 2 velas fuera de rango (> 65k) y 1 dentro
    const mockCandles: OHLCV[] = [
      {
        timestamp: now,
        open: new Decimal('66000'),
        high: new Decimal('67000'),
        low: new Decimal('65500'), // Fuera del rango
        close: new Decimal('66500'),
        volume: new Decimal('1'),
      },
      {
        timestamp: now + 60000,
        open: new Decimal('66500'),
        high: new Decimal('68000'),
        low: new Decimal('66000'), // Fuera del rango
        close: new Decimal('67000'),
        volume: new Decimal('1'),
      },
      {
        timestamp: now + 120000,
        open: new Decimal('64000'),
        high: new Decimal('64500'),
        low: new Decimal('63500'), // Dentro del rango
        close: new Decimal('64200'),
        volume: new Decimal('1'),
      },
    ];

    const result = backtester.run(mockCandles);

    expect(result.totalCandles).toBe(3);
    expect(result.outOfBoundsCandlesCount).toBe(2);
    expect(result.outOfBoundsPercent.toFixed(2)).toBe('66.67');
  });
});
