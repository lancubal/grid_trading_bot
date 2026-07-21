import { describe, it, expect, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { Bootstrapper } from './bootstrapper';
import { IExchangeAdapter } from '../exchange/adapter';
import { StateRepository } from '../db/repository';
import { GridManager } from './gridManager';

describe('Bootstrapper - Crash Recovery & State Reconciliation Tests', () => {
  let mockExchangeAdapter: IExchangeAdapter;
  let mockStateRepository: StateRepository;
  let gridManager: GridManager;
  let bootstrapper: Bootstrapper;

  beforeEach(() => {
    gridManager = new GridManager({
      symbol: 'BTC/USDT',
      lowerPrice: new Decimal('60000.00'),
      upperPrice: new Decimal('65000.00'),
      gridLevels: 6,
      investment: new Decimal('5000.00'),
    });

    mockExchangeAdapter = {
      initialize: vi.fn(),
      fetchTicker: vi.fn(),
      fetchBalance: vi.fn(),
      createOrder: vi.fn().mockResolvedValue({
        id: 'new-flip-id-999',
        symbol: 'BTC/USDT',
        type: 'limit',
        side: 'sell',
        price: new Decimal('62000'),
        amount: new Decimal('0.01'),
        filled: new Decimal('0'),
        remaining: new Decimal('0.01'),
        status: 'open',
        timestamp: Date.now(),
      }),
      cancelOrder: vi.fn(),
      fetchOrder: vi.fn(),
      fetchOpenOrders: vi.fn(),
    };

    mockStateRepository = {
      getAllGridLevels: vi.fn(),
      getOpenOrders: vi.fn(),
      updateOrderStatusById: vi.fn(),
      updateOrderStatusByExchangeId: vi.fn(),
      createOrderRecord: vi.fn(),
      upsertGridLevel: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as StateRepository;

    bootstrapper = new Bootstrapper(mockExchangeAdapter, mockStateRepository, gridManager);
  });

  it('debe detectar una grilla nueva (Fresh Grid) si no hay niveles en BD', async () => {
    vi.spyOn(mockStateRepository, 'getAllGridLevels').mockResolvedValue([]);

    const result = await bootstrapper.reconcile('BTC/USDT');

    expect(result.isFreshGrid).toBe(true);
    expect(result.restoredOpenOrdersCount).toBe(0);
  });

  it('debe restaurar órdenes intactas si siguen abiertas en el exchange', async () => {
    vi.spyOn(mockStateRepository, 'getAllGridLevels').mockResolvedValue([
      { levelIndex: 0, price: new Decimal('60000'), isHolding: false, updatedAt: new Date() },
    ] as any);

    vi.spyOn(mockStateRepository, 'getOpenOrders').mockResolvedValue([
      {
        id: 'db-ord-1',
        exchangeId: 'ex-ord-100',
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: new Decimal('60000'),
        amount: new Decimal('0.01'),
        gridLevelId: 0,
        status: 'OPEN',
      },
    ] as any);

    vi.spyOn(mockExchangeAdapter, 'fetchOpenOrders').mockResolvedValue([
      {
        id: 'ex-ord-100',
        symbol: 'BTC/USDT',
        type: 'limit',
        side: 'buy',
        price: new Decimal('60000'),
        amount: new Decimal('0.01'),
        filled: new Decimal('0'),
        remaining: new Decimal('0.01'),
        status: 'open',
        timestamp: Date.now(),
      },
    ]);

    const result = await bootstrapper.reconcile('BTC/USDT');

    expect(result.isFreshGrid).toBe(false);
    expect(result.restoredOpenOrdersCount).toBe(1);
    expect(result.offlineFillsCount).toBe(0);
  });

  it('debe procesar Fills ocurridos offline y generar la contra-orden ("Flip")', async () => {
    vi.spyOn(mockStateRepository, 'getAllGridLevels').mockResolvedValue([
      { levelIndex: 1, price: new Decimal('61000'), isHolding: false, updatedAt: new Date() },
      { levelIndex: 2, price: new Decimal('62000'), isHolding: false, updatedAt: new Date() },
    ] as any);

    vi.spyOn(mockStateRepository, 'getOpenOrders').mockResolvedValue([
      {
        id: 'db-ord-2',
        exchangeId: 'ex-ord-200',
        symbol: 'BTC/USDT',
        side: 'BUY',
        price: new Decimal('61000'),
        amount: new Decimal('0.01'),
        gridLevelId: 1,
        status: 'OPEN',
      },
    ] as any);

    // No está en la lista de órdenes abiertas en el Exchange
    vi.spyOn(mockExchangeAdapter, 'fetchOpenOrders').mockResolvedValue([]);

    // Al consultar la orden individualmente, el exchange indica que se ejecutó ('closed')
    vi.spyOn(mockExchangeAdapter, 'fetchOrder').mockResolvedValue({
      id: 'ex-ord-200',
      symbol: 'BTC/USDT',
      type: 'limit',
      side: 'buy',
      price: new Decimal('61000'),
      amount: new Decimal('0.01'),
      filled: new Decimal('0.01'),
      remaining: new Decimal('0'),
      status: 'closed',
      timestamp: Date.now(),
    });

    const result = await bootstrapper.reconcile('BTC/USDT');

    expect(result.offlineFillsCount).toBe(1);
    expect(result.newFlipsCreatedCount).toBe(1);
    expect(mockStateRepository.updateOrderStatusById).toHaveBeenCalledWith('db-ord-2', 'FILLED');
    expect(mockExchangeAdapter.createOrder).toHaveBeenCalled();
    expect(mockStateRepository.createOrderRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        exchangeId: 'new-flip-id-999',
        side: 'SELL',
        gridLevelId: 2,
      })
    );
  });
});
