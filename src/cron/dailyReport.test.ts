import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { setupDailyReportCron } from './dailyReport';
import { StateRepository } from '../db/repository';
import { SlackNotifier } from '../core/notifier';
import { GridManager } from '../core/gridManager';
import { LiveVolatilityEngine } from '../core/volatility';
import { IExchangeAdapter } from '../exchange/adapter';
import { OrderSide, OrderStatus } from '@prisma/client';

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, callback: Function) => {
      // Exponer el callback para ejecutarlo manualmente en las pruebas
      (setupDailyReportCron as any).triggerCron = callback;
    }),
  },
}));

describe('setupDailyReportCron - Daily Summary Audit & Legacy Vault Reporting', () => {
  it('debe calcular métricas reales de órdenes ejecutadas, comisiones, balances y estado de la bóveda legacy', async () => {
    const mockOrders = [
      {
        id: 'ord-buy-1',
        side: OrderSide.BUY,
        price: new Decimal(63000),
        amount: new Decimal(0.001),
        feeCost: new Decimal(0.063),
        status: OrderStatus.FILLED,
        updatedAt: new Date(),
      },
      {
        id: 'ord-sell-1',
        side: OrderSide.SELL,
        price: new Decimal(63210),
        amount: new Decimal(0.001),
        feeCost: new Decimal(0.0632),
        status: OrderStatus.FILLED,
        updatedAt: new Date(),
      },
    ];

    const mockLegacyOrders = [
      {
        id: 'leg-1',
        side: OrderSide.SELL,
        price: new Decimal(64500),
        amount: new Decimal(0.0015),
        feeCost: new Decimal(0.096),
        status: OrderStatus.FILLED,
        updatedAt: new Date(),
      },
    ];

    const mockOpenLegacyOrders = [
      {
        id: 'leg-open-1',
        side: OrderSide.SELL,
        price: new Decimal(65000),
        amount: new Decimal(0.01),
        status: OrderStatus.OPEN,
      },
      {
        id: 'leg-open-2',
        side: OrderSide.SELL,
        price: new Decimal(66000),
        amount: new Decimal(0.015),
        status: OrderStatus.OPEN,
      },
    ];

    const mockRepo = {
      getOrdersFilledInDateRange: vi.fn().mockResolvedValue(mockOrders),
      getLegacyOrdersFilledInDateRange: vi.fn().mockResolvedValue(mockLegacyOrders),
      getOpenLegacyOrders: vi.fn().mockResolvedValue(mockOpenLegacyOrders),
    } as unknown as StateRepository;

    let capturedSummary: any = null;
    const mockNotifier = {
      notifyDailySummary: vi.fn().mockImplementation((data) => {
        capturedSummary = data;
        return Promise.resolve(true);
      }),
    } as unknown as SlackNotifier;

    const mockAdapter = {
      fetchBalance: vi.fn().mockResolvedValue({
        free: { USDT: 150.5, BTC: 0.002 },
        total: { USDT: 250.0, BTC: 0.027 },
      }),
      fetchTicker: vi.fn().mockResolvedValue({ last: 63500 }),
    } as unknown as IExchangeAdapter;

    const gridManager = new GridManager({
      symbol: 'BTC/USDT',
      lowerPrice: new Decimal(60000),
      upperPrice: new Decimal(64000),
      gridLevels: 20,
      investment: new Decimal(2000),
    });

    const volatilityEngine = new LiveVolatilityEngine();

    setupDailyReportCron(mockRepo, mockNotifier, mockAdapter, gridManager, volatilityEngine, 'BTC/USDT');

    // Disparar el cron programado
    await (setupDailyReportCron as any).triggerCron();

    expect(mockRepo.getOrdersFilledInDateRange).toHaveBeenCalled();
    expect(mockRepo.getLegacyOrdersFilledInDateRange).toHaveBeenCalled();
    expect(mockRepo.getOpenLegacyOrders).toHaveBeenCalled();
    expect(mockNotifier.notifyDailySummary).toHaveBeenCalled();

    expect(capturedSummary).not.toBeNull();
    expect(capturedSummary.totalBuyOrders).toBe(1);
    expect(capturedSummary.totalSellOrders).toBe(1);
    expect(capturedSummary.flipsCompleted).toBe(1);
    expect(capturedSummary.netProfitUsd).toBeGreaterThan(0);
    expect(capturedSummary.legacyVault.openOrdersCount).toBe(2);
    expect(capturedSummary.legacyVault.totalBtc).toBe(0.025);
    expect(capturedSummary.legacyVault.fillsCompletedYesterday).toBe(1);
  });
});
