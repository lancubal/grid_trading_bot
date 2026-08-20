import { describe, it, expect, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { AutoBnbFeeManager } from './autoBnbFeeManager';
import { IExchangeAdapter } from '../exchange/adapter';
import { SlackNotifier } from './notifier';

describe('AutoBnbFeeManager Unit Tests', () => {
  let mockAdapter: IExchangeAdapter;
  let mockNotifier: SlackNotifier;
  let feeManager: AutoBnbFeeManager;

  beforeEach(() => {
    mockAdapter = {
      initialize: vi.fn(),
      fetchTicker: vi.fn().mockResolvedValue({
        symbol: 'BNB/USDT',
        bid: new Decimal('580'),
        ask: new Decimal('580'),
        last: new Decimal('580'),
        timestamp: Date.now(),
      }),
      fetchBalance: vi.fn().mockResolvedValue({
        free: {
          BNB: new Decimal('0.01'), // ~$5.80 USD (< $25 threshold)
          USDT: new Decimal('500.00'), // Plenty of USDT (> $50 refill + $50 buffer)
        },
        used: {},
        total: {},
      }),
      createOrder: vi.fn().mockResolvedValue({
        id: 'bnb-order-123',
        symbol: 'BNB/USDT',
        type: 'market',
        side: 'buy',
        price: new Decimal('580'),
        amount: new Decimal('0.0862'),
        filled: new Decimal('0.0862'),
        remaining: new Decimal('0'),
        status: 'closed',
        timestamp: Date.now(),
      }),
      cancelOrder: vi.fn(),
      fetchOrder: vi.fn(),
      fetchOpenOrders: vi.fn(),
    };

    mockNotifier = {
      isEnabled: vi.fn().mockReturnValue(true),
      sendSlackMessage: vi.fn().mockResolvedValue(true),
    } as unknown as SlackNotifier;

    feeManager = new AutoBnbFeeManager({
      enabled: true,
      minThresholdUsd: new Decimal('25.00'),
      refillAmountUsd: new Decimal('50.00'),
      cooldownHours: 12.0,
      safetyUsdtBufferUsd: new Decimal('50.00'),
      isDryRun: false,
    });
  });

  it('debe ejecutar la compra de BNB cuando el saldo está por debajo de $25 USD y hay suficiente USDT libre', async () => {
    const result = await feeManager.evaluateAndRefill(mockAdapter, mockNotifier);

    expect(result.refilled).toBe(true);
    expect(mockAdapter.createOrder).toHaveBeenCalledWith({
      symbol: 'BNB/USDT',
      type: 'market',
      side: 'buy',
      amount: expect.any(Decimal),
    });
    expect(mockNotifier.sendSlackMessage).toHaveBeenCalledWith(expect.stringContaining('AUTO-RECARGA AUTÓNOMA DE BNB'));
  });

  it('debe omitir la recarga si el saldo de BNB es suficiente (>= $25 USD)', async () => {
    vi.spyOn(mockAdapter, 'fetchBalance').mockResolvedValue({
      free: {
        BNB: new Decimal('0.10'), // ~$58.00 USD (>= $25)
        USDT: new Decimal('500.00'),
      },
      used: {},
      total: {},
    });

    const result = await feeManager.evaluateAndRefill(mockAdapter, mockNotifier);

    expect(result.refilled).toBe(false);
    expect(result.reason).toContain('Saldo BNB suficiente');
    expect(mockAdapter.createOrder).not.toHaveBeenCalled();
  });

  it('debe bloquear la recarga si el saldo libre en USDT es insuficiente para no afectar la grilla de BTC', async () => {
    vi.spyOn(mockAdapter, 'fetchBalance').mockResolvedValue({
      free: {
        BNB: new Decimal('0.01'), // Low BNB
        USDT: new Decimal('80.00'), // Less than $50 refill + $50 buffer ($100 required)
      },
      used: {},
      total: {},
    });

    const result = await feeManager.evaluateAndRefill(mockAdapter, mockNotifier);

    expect(result.refilled).toBe(false);
    expect(result.reason).toContain('USDT libre insuficiente');
    expect(mockAdapter.createOrder).not.toHaveBeenCalled();
  });

  it('debe respetar el período de cooldown de 12 horas tras una recarga', async () => {
    // Primera recarga exitosa
    const firstResult = await feeManager.evaluateAndRefill(mockAdapter, mockNotifier);
    expect(firstResult.refilled).toBe(true);

    // Segundo intento inmediato
    const secondResult = await feeManager.evaluateAndRefill(mockAdapter, mockNotifier);
    expect(secondResult.refilled).toBe(false);
    expect(secondResult.reason).toContain('En período de cooldown');
  });

  it('debe simular la compra sin llamar al exchange si isDryRun es true', async () => {
    const dryRunManager = new AutoBnbFeeManager({
      enabled: true,
      minThresholdUsd: new Decimal('25.00'),
      refillAmountUsd: new Decimal('50.00'),
      cooldownHours: 12.0,
      safetyUsdtBufferUsd: new Decimal('50.00'),
      isDryRun: true,
    });

    const result = await dryRunManager.evaluateAndRefill(mockAdapter, mockNotifier);

    expect(result.refilled).toBe(true);
    expect(mockAdapter.createOrder).not.toHaveBeenCalled();
  });
});
