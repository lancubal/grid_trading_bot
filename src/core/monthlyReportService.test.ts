import { describe, it, expect } from 'vitest';
import { calculateRangeProfit } from './monthlyReportService';

describe('MonthlyReportService Unit Tests', () => {
  it('debe calcular correctamente el profit neto, volumen y comisiones para un conjunto de fills FIFO', () => {
    const mockFills = [
      { side: 'BUY', price: 60000, amount: 0.1, fee: 2.25 },
      { side: 'SELL', price: 61000, amount: 0.1, fee: 2.28 },
    ];

    const result = calculateRangeProfit(mockFills);

    // Spread: (61000 - 60000) * 0.1 = 100 USD
    // Fees: 2.25 + 2.28 = 4.53 USD
    // Net profit: 100 - 4.53 = 95.47 USD
    expect(result.netProfitUsd).toBe(95.47);
    expect(result.totalVolumeUsd).toBe(12100);
    expect(result.totalFeesUsd).toBe(4.53);
  });

  it('debe devolver 0 si no hay fills en el período', () => {
    const result = calculateRangeProfit([]);
    expect(result.netProfitUsd).toBe(0);
    expect(result.totalVolumeUsd).toBe(0);
    expect(result.totalFeesUsd).toBe(0);
  });
});
