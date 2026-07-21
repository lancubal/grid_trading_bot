import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { OrderSide, OrderStatus } from '@prisma/client';
import { LocalMatchingEngine } from './matchingEngine';

describe('LocalMatchingEngine - Virtual Order Matching Tests', () => {
  it('debe emparejar una orden de compra virtual en BD y emitir ORDER_FILLED cuando el precio de mercado cae al nivel', async () => {
    const eventEmitter = new EventEmitter();
    const fillSpy = vi.fn();
    eventEmitter.on('ORDER_FILLED', fillSpy);

    const mockOrder = {
      id: 'db-ord-1',
      exchangeId: 'shadow-123',
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      price: new Decimal(64000),
      amount: new Decimal(0.001),
      status: OrderStatus.OPEN,
      gridLevelId: 2,
    };

    const mockRepo: any = {
      getOpenOrders: vi.fn().mockResolvedValue([mockOrder]),
      updateOrderStatusById: vi.fn().mockResolvedValue(true),
    };

    const engine = new LocalMatchingEngine(mockRepo, eventEmitter);

    // Ticker más alto: No debe emparejar
    await engine.processLivePrice(new Decimal(65000));
    expect(fillSpy).not.toHaveBeenCalled();

    // Ticker en $63,900 USD (menor o igual a $64,000 USD): Debe emparejar y actualizar BD
    await engine.processLivePrice(new Decimal(63900));

    expect(mockRepo.updateOrderStatusById).toHaveBeenCalledWith('db-ord-1', OrderStatus.FILLED, expect.any(Decimal));
    expect(fillSpy).toHaveBeenCalledTimes(1);

    const payload = fillSpy.mock.calls[0][0];
    expect(payload.side).toBe('buy');
    expect(payload.gridLevel).toBe(2);
  });

  it('debe emparejar una orden de venta virtual en BD y emitir ORDER_FILLED cuando el precio de mercado sube al nivel', async () => {
    const eventEmitter = new EventEmitter();
    const fillSpy = vi.fn();
    eventEmitter.on('ORDER_FILLED', fillSpy);

    const mockOrder = {
      id: 'db-ord-2',
      exchangeId: 'shadow-456',
      symbol: 'BTC/USDT',
      side: OrderSide.SELL,
      price: new Decimal(66000),
      amount: new Decimal(0.001),
      status: OrderStatus.OPEN,
      gridLevelId: 10,
    };

    const mockRepo: any = {
      getOpenOrders: vi.fn().mockResolvedValue([mockOrder]),
      updateOrderStatusById: vi.fn().mockResolvedValue(true),
    };

    const engine = new LocalMatchingEngine(mockRepo, eventEmitter);

    // Ticker en $66,100 USD (mayor o igual a $66,000 USD): Debe emparejar
    await engine.processLivePrice(new Decimal(66100));

    expect(mockRepo.updateOrderStatusById).toHaveBeenCalledWith('db-ord-2', OrderStatus.FILLED, expect.any(Decimal));
    expect(fillSpy).toHaveBeenCalledTimes(1);
    expect(fillSpy.mock.calls[0][0].side).toBe('sell');
  });
});
