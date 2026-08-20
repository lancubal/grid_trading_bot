import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { GridManager } from './gridManager';
import { GridConfigInput } from '../config';

describe('GridManager - Core Strategy & Dual-Layer / Legacy Tests', () => {
  const baseConfig: GridConfigInput = {
    symbol: 'BTC/USDT',
    lowerPrice: new Decimal(63000),
    upperPrice: new Decimal(66000),
    gridLevels: 15, // 14 intervalos de ~$214.29
    investment: new Decimal(1000),
    takeProfitMultiplier: 1.8,
    enableDualLayer: true,
    microCapitalRatio: 0.25,
    microGridRangeUsd: new Decimal(2000),
    microGridLevels: 5,
  };

  it('debe inicializar la grilla con 15 niveles y calcular el escalón correcto', () => {
    const manager = new GridManager(baseConfig);
    const levels = manager.getLevels();

    expect(levels.length).toBe(15);
    expect(levels[0].price.toString()).toBe('63000');
    expect(levels[14].price.toString()).toBe('66000');
    expect(manager.getStepSize().toFixed(2)).toBe('214.29');
  });

  it('debe generar órdenes de siembra iniciales de doble capa (Macro y Micro)', () => {
    const manager = new GridManager(baseConfig);
    const currentPrice = 64500;
    const seedOrders = manager.generateSeedOrders(currentPrice);

    expect(seedOrders.length).toBeGreaterThan(0);
    const microOrders = seedOrders.filter((o) => o.layer === 'micro');
    const macroOrders = seedOrders.filter((o) => o.layer === 'macro');

    expect(microOrders.length).toBeGreaterThan(0);
    expect(macroOrders.length).toBeGreaterThan(0);
  });

  it('debe generar contra-orden Flip con Take-Profit Asimétrico para la capa Macro', () => {
    const manager = new GridManager(baseConfig);
    const flipSellPlan = manager.handleOrderFill(
      {
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
      },
      'macro'
    );

    expect(flipSellPlan).not.toBeNull();
    expect(flipSellPlan?.side).toBe('sell');
    // step = 214.2857 * 1.8 = 385.714 -> price = 63000 + 385.714 = 63385.71
    expect(flipSellPlan?.price.toNumber()).toBeGreaterThan(63300);
  });

  it('debe gestionar la Bóveda Legacy reteniendo órdenes sin vender a pérdida', () => {
    const manager = new GridManager(baseConfig);

    manager.addLegacyOrder({
      orderId: 'leg-1',
      price: new Decimal(68000),
      amount: new Decimal(0.05),
    });

    expect(manager.getLegacyVault().length).toBe(1);

    // Si el precio es $65,000 no debe llenarse
    const fillsLow = manager.checkLegacyFills(65000);
    expect(fillsLow.length).toBe(0);
    expect(manager.getLegacyVault().length).toBe(1);

    // Si el precio sube a $68,500 debe ejecutarse y vaciar la bóveda
    const fillsHigh = manager.checkLegacyFills(68500);
    expect(fillsHigh.length).toBe(1);
    expect(fillsHigh[0].price.toString()).toBe('68000');
    expect(manager.getLegacyVault().length).toBe(0);
  });
});
