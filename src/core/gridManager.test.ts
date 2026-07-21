import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { GridManager } from './gridManager';
import { GridConfigInput } from '../config';

describe('GridManager - Core Strategy & ATR Volatility Tests', () => {
  const baseConfig: GridConfigInput = {
    symbol: 'BTC/USDT',
    lowerPrice: new Decimal(63000),
    upperPrice: new Decimal(66000),
    gridLevels: 15, // 14 intervalos de ~$214.29
    investment: new Decimal(1000),
  };

  it('debe inicializar la grilla con 15 niveles y calcular el escalón correcto', () => {
    const manager = new GridManager(baseConfig);
    const levels = manager.getLevels();

    expect(levels.length).toBe(15);
    expect(levels[0].price.toString()).toBe('63000');
    expect(levels[14].price.toString()).toBe('66000');
    expect(manager.getStepSize().toFixed(2)).toBe('214.29');
  });

  it('debe generar órdenes de siembra iniciales dividiendo las zonas por el precio actual', () => {
    const manager = new GridManager(baseConfig);
    const currentPrice = 64500;
    const seedOrders = manager.generateSeedOrders(currentPrice);

    expect(seedOrders.length).toBeGreaterThan(0);
    seedOrders.forEach((ord) => {
      if (ord.side === 'buy') {
        expect(ord.price.lessThan(currentPrice)).toBe(true);
      } else {
        expect(ord.price.greaterThan(currentPrice)).toBe(true);
      }
    });
  });

  it('debe generar la contra-orden Flip correcta tras la ejecución de una orden', () => {
    const manager = new GridManager(baseConfig);
    const flipSellPlan = manager.handleOrderFill({
      id: 'db-1',
      clientOrderId: 'ex-1',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      status: 'closed',
      price: new Decimal(63000),
      amount: new Decimal(0.001),
      filled: new Decimal(0.001),
      remaining: new Decimal(0),
      gridLevel: 0,
      timestamp: Date.now(),
    });

    expect(flipSellPlan).not.toBeNull();
    expect(flipSellPlan?.side).toBe('sell');
    expect(flipSellPlan?.levelIndex).toBe(1);
  });

  it('debe ajustar dinámicamente el rango y los niveles según la volatilidad del ATR', () => {
    const manager = new GridManager(baseConfig);
    const atr = new Decimal(500); // 500 * 4 = 2000 USD de rango
    const currentPrice = new Decimal(65000);

    const result = manager.adjustToVolatility(atr, currentPrice, 4.0, 1500, 6000);

    expect(result.dynamicRange.toString()).toBe('2000');
    expect(result.newLowerPrice.toString()).toBe('64000'); // 65000 - 1000
    expect(result.newUpperPrice.toString()).toBe('66000'); // 65000 + 1000
    expect(manager.getStepSize().toFixed(2)).toBe('142.86'); // 2000 / 14 = 142.86 USD por escalón
  });
});
