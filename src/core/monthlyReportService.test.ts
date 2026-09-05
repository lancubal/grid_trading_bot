import { describe, it, expect } from 'vitest';
import { calculateContinuousMonthlyStats } from './monthlyReportService';

describe('MonthlyReportService Unit Tests', () => {
  it('debe calcular la ganancia por spread de grilla para las ventas del mes', () => {
    const mockFills = [
      { side: 'BUY', price: 60000, amount: 0.1, fee: 2.25, updatedAt: new Date('2026-09-01T02:00:00Z') },
      { side: 'SELL', price: 60850, amount: 0.1, fee: 2.28, updatedAt: new Date('2026-09-01T05:00:00Z') },
    ];

    const statsMap = calculateContinuousMonthlyStats(mockFills);
    const sepStats = statsMap.get('2026-9')!;

    // Spread = 850 * 0.1 = 85.00 USD
    // Fees = 2.25 + 2.28 = 4.53 USD
    // Net Profit = 85.00 - 4.53 = 80.47 USD
    expect(sepStats.netProfitUsd).toBe(80.47);
    expect(sepStats.totalTrades).toBe(2);
  });

  it('debe devolver mapa vacío si no hay fills', () => {
    const statsMap = calculateContinuousMonthlyStats([]);
    expect(statsMap.size).toBe(0);
  });
});
