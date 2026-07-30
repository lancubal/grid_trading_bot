import { describe, it, expect, vi } from 'vitest';
import { SlackNotifier } from './notifier';

describe('SlackNotifier - Observability & Babysitting Tests', () => {
  it('debe respetar el Kill-Switch (enabled = false) y no enviar mensajes a Slack', async () => {
    const notifier = new SlackNotifier(false, 'https://hooks.slack.com/mock');
    expect(notifier.isEnabled()).toBe(false);

    const res = await notifier.notifyOrderExecution({
      side: 'BUY',
      symbol: 'BTC/USDT',
      amount: 0.001,
      price: 64000,
    });

    expect(res).toBe(false);
  });

  it('debe enviar formateado correctamente una orden de COMPRA cuando está habilitado', async () => {
    const notifier = new SlackNotifier(true, 'https://hooks.slack.com/mock');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => 'ok',
    } as Response);

    const res = await notifier.notifyOrderExecution({
      side: 'BUY',
      symbol: 'BTC/USDT',
      amount: 0.0011,
      price: 64440.33,
      usdtBalance: 850,
    });

    expect(res).toBe(true);
  });

  it('debe enviar formateado correctamente una orden de VENTA (Flip) cuando está habilitado', async () => {
    const notifier = new SlackNotifier(true, 'https://hooks.slack.com/mock');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => 'ok',
    } as Response);

    const res = await notifier.notifyOrderExecution({
      side: 'SELL',
      symbol: 'BTC/USDT',
      amount: 0.0011,
      price: 65511.76,
      netProfitUsd: 1.5,
    });

    expect(res).toBe(true);
  });

  it('debe enviar la notificación de rescate de Binance Simple Earn', async () => {
    const notifier = new SlackNotifier(true, 'https://hooks.slack.com/mock');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => 'ok',
    } as Response);

    const res = await notifier.notifyAutoInjection({
      amountUsd: 1000,
      lifetimeAllocationUsd: 2000,
      maxLifetimeAllocationUsd: 10000,
      cooldownDays: 20,
    });

    expect(res).toBe(true);
  });
});
