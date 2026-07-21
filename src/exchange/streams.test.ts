import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { CcxtExchangeStreams, MockExchangeStreams } from './streams';
import { OrderExecutionEvent } from '../types';

describe('ExchangeStreams - WebSocket Payload Parsing & Zod Validation Tests', () => {
  const config = {
    exchangeId: 'binance',
    isTestnet: true,
  };

  it('debe procesar y validar un payload válido de orden ejecutada (CLOSED) y emitir order:filled', () => {
    const streams = new CcxtExchangeStreams(config);
    let emittedEvent: OrderExecutionEvent | null = null;

    streams.on('order:filled', (evt) => {
      emittedEvent = evt;
    });

    const rawOrderPayload = {
      id: 'ws-ord-100',
      clientOrderId: 'client-1',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      price: 61000.5,
      amount: 0.05,
      filled: 0.05,
      remaining: 0,
      status: 'closed',
      timestamp: 1680000000000,
    };

    const result = streams.processRawOrder(rawOrderPayload);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('ws-ord-100');
    expect(result?.price.toString()).toBe('61000.5');
    expect(result?.amount.toString()).toBe('0.05');
    expect(result?.status).toBe('closed');
    expect(emittedEvent).toEqual(result);
  });

  it('debe rechazar un payload inválido que falle las reglas de validación de Zod', () => {
    const streams = new CcxtExchangeStreams(config);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const invalidPayload = {
      id: 'invalid-ord',
      symbol: 'BTC/USDT',
      side: 'invalid_side', // Side no permitido por Zod Enum ('buy' | 'sell')
      type: 'limit',
      price: 'not_a_number',
    };

    const result = streams.processRawOrder(invalidPayload);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('debe permitir simular fills mediante MockExchangeStreams para testing local', () => {
    const mockStreams = new MockExchangeStreams();
    let emittedEvent: OrderExecutionEvent | null = null;

    mockStreams.on('order:filled', (evt) => {
      emittedEvent = evt;
    });

    const mockEvent: OrderExecutionEvent = {
      id: 'mock-1',
      symbol: 'BTC/USDT',
      side: 'sell',
      type: 'limit',
      price: new Decimal('63000'),
      amount: new Decimal('0.02'),
      filled: new Decimal('0.02'),
      remaining: new Decimal('0'),
      status: 'closed',
      timestamp: Date.now(),
      gridLevel: 3,
    };

    mockStreams.simulateOrderFill(mockEvent);

    expect(emittedEvent).not.toBeNull();
    expect((emittedEvent as any)?.id).toBe('mock-1');
    expect((emittedEvent as any)?.side).toBe('sell');
  });
});
