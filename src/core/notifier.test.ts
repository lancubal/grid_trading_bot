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
      netProfitUsd: 0.02,
    });

    expect(res).toBe(true);
  });

  it('debe enviar formateado correctamente una orden de VENTA LEGACY indicando capital recuperado a caja', async () => {
    const notifier = new SlackNotifier(true, 'https://hooks.slack.com/mock');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => 'ok',
    } as Response);

    const res = await notifier.notifyLegacyOrderExecution({
      symbol: 'BTC/USDT',
      amount: 0.00009,
      price: 63554.7,
      recoveredUsdt: 5.71,
      usdtBalance: 50.2,
    });

    expect(res).toBe(true);
  });
});
