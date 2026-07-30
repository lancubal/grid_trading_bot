import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { ShadowExchangeAdapter } from './shadowAdapter';
import { isInsufficientFundsError, executeWithRetry } from './adapter';

describe('ShadowExchangeAdapter - Real-Time Shadow Trading Simulation', () => {
  const config = {
    exchangeId: 'binance',
    isTestnet: true,
  };

  it('debe registrar órdenes en memoria y simular un Fill de COMPRA cuando el precio en vivo cae al nivel límite', async () => {
    const adapter = new ShadowExchangeAdapter(config);
    const fillSpy = vi.fn();
    adapter.on('order:filled', fillSpy);

    const order = await adapter.createOrder({
      symbol: 'BTC/USDT',
      type: 'limit',
      side: 'buy',
      price: new Decimal(64000),
      amount: new Decimal(0.001),
    });

    expect(order.status).toBe('open');

    // Ticker con precio más alto: No debe llenar
    adapter.processPriceTick(new Decimal(65000), 'BTC/USDT');
    expect(fillSpy).not.toHaveBeenCalled();

    // Ticker con precio de mercado que toca la orden buy ($64,000 USD): Debe llenar
    adapter.processPriceTick(new Decimal(63950), 'BTC/USDT');
    expect(fillSpy).toHaveBeenCalledTimes(1);

    const openOrders = await adapter.fetchOpenOrders('BTC/USDT');
    expect(openOrders.length).toBe(0);
  });

  it('debe simular un Fill de VENTA cuando el precio en vivo sube al nivel límite', async () => {
    const adapter = new ShadowExchangeAdapter(config);
    const fillSpy = vi.fn();
    adapter.on('order:filled', fillSpy);

    await adapter.createOrder({
      symbol: 'BTC/USDT',
      type: 'limit',
      side: 'sell',
      price: new Decimal(66000),
      amount: new Decimal(0.001),
    });

    // Ticker que supera el precio de venta ($66,000 USD)
    adapter.processPriceTick(new Decimal(66100), 'BTC/USDT');
    expect(fillSpy).toHaveBeenCalledTimes(1);
  });

  it('debe identificar correctamente errores de Insufficient Funds (-2010) de Binance', () => {
    const binanceError = new Error('binance {"code":-2010,"msg":"Account has insufficient balance for requested action."}');
    expect(isInsufficientFundsError(binanceError)).toBe(true);

    const genericError = new Error('Network timeout');
    expect(isInsufficientFundsError(genericError)).toBe(false);
  });

  it('debe reintentar llamadas asíncronas con Exponential Backoff ante errores 502/504 o timeout', async () => {
    let calls = 0;
    const mockApiCall = async () => {
      calls++;
      if (calls < 3) {
        throw new Error('HTTP 502 Bad Gateway Timeout');
      }
      return 'SUCCESS';
    };

    const res = await executeWithRetry(mockApiCall, 3, 10, 'TestCall');
    expect(res).toBe('SUCCESS');
    expect(calls).toBe(3);
  });
});
