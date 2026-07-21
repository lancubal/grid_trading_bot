import { describe, it, expect, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { GridManager } from './gridManager';
import { GridConfigInput } from '../config';

describe('GridManager - Core Engine Tests', () => {
  let gridConfig: GridConfigInput;

  beforeEach(() => {
    gridConfig = {
      symbol: 'BTC/USDT',
      lowerPrice: new Decimal('60000.00'),
      upperPrice: new Decimal('65000.00'),
      gridLevels: 6, // 60k, 61k, 62k, 63k, 64k, 65k (paso de 1k)
      investment: new Decimal('5000.00'),
    };
  });

  it('debe calcular correctamente los niveles de precio y el paso entre grillas', () => {
    const gridManager = new GridManager(gridConfig);
    const levels = gridManager.getLevels();

    expect(levels.length).toBe(6);
    expect(gridManager.getStepSize().toString()).toBe('1000');
    expect(levels[0].price.toString()).toBe('60000');
    expect(levels[1].price.toString()).toBe('61000');
    expect(levels[5].price.toString()).toBe('65000');
  });

  it('debe generar órdenes de siembra (seed) de COMPRA por debajo del precio actual y VENTA por encima', () => {
    const gridManager = new GridManager(gridConfig);
    const currentPrice = new Decimal('62500.00'); // Entre nivel 2 (62k) y 3 (63k)

    const seedOrders = gridManager.generateSeedOrders(currentPrice);

    // Niveles 0 (60k), 1 (61k), 2 (62k) son COMPRA (3 órdenes)
    // Niveles 3 (63k), 4 (64k), 5 (65k) son VENTA (3 órdenes)
    expect(seedOrders.length).toBe(6);

    const buyOrders = seedOrders.filter((o) => o.side === 'buy');
    const sellOrders = seedOrders.filter((o) => o.side === 'sell');

    expect(buyOrders.length).toBe(3);
    expect(sellOrders.length).toBe(3);

    expect(buyOrders[0].levelIndex).toBe(0);
    expect(buyOrders[0].price.toString()).toBe('60000');

    expect(sellOrders[0].levelIndex).toBe(3);
    expect(sellOrders[0].price.toString()).toBe('63000');
  });

  it('debe emitir un evento FLIP de VENTA al ejecutarse un Fill de COMPRA en el nivel N', () => {
    const gridManager = new GridManager(gridConfig);
    let emittedFlip: any = null;

    gridManager.on('grid:flip_required', (plan) => {
      emittedFlip = plan;
    });

    const fillEvent = {
      id: 'ord-123',
      symbol: 'BTC/USDT',
      side: 'buy' as const,
      type: 'limit' as const,
      price: new Decimal('61000.00'),
      amount: new Decimal('0.01'),
      filled: new Decimal('0.01'),
      remaining: new Decimal('0'),
      status: 'closed' as const,
      timestamp: Date.now(),
      gridLevel: 1, // Fill en nivel 61k
    };

    const result = gridManager.handleOrderFill(fillEvent);

    expect(result).not.toBeNull();
    expect(result?.side).toBe('sell');
    expect(result?.levelIndex).toBe(2); // Nivel 62k
    expect(result?.price.toString()).toBe('62000');
    expect(emittedFlip).toEqual(result);
  });

  it('debe emitir un evento FLIP de COMPRA al ejecutarse un Fill de VENTA en el nivel N', () => {
    const gridManager = new GridManager(gridConfig);

    const fillEvent = {
      id: 'ord-456',
      symbol: 'BTC/USDT',
      side: 'sell' as const,
      type: 'limit' as const,
      price: new Decimal('63000.00'),
      amount: new Decimal('0.01'),
      filled: new Decimal('0.01'),
      remaining: new Decimal('0'),
      status: 'closed' as const,
      timestamp: Date.now(),
      gridLevel: 3, // Fill en nivel 63k
    };

    const result = gridManager.handleOrderFill(fillEvent);

    expect(result).not.toBeNull();
    expect(result?.side).toBe('buy');
    expect(result?.levelIndex).toBe(2); // Nivel 62k
    expect(result?.price.toString()).toBe('62000');
  });
});
