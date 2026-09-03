import { describe, it, expect } from 'vitest';
import { calculateContinuousMonthlyStats } from './monthlyReportService';

describe('MonthlyReportService Unit Tests', () => {
  it('debe mantener la continuidad del inventario FIFO a través de distintos meses', () => {
    const mockFills = [
      // Compra en Agosto
      { side: 'BUY', price: 60000, amount: 0.1, fee: 2.25, updatedAt: new Date('2026-08-31T20:00:00Z') },
      // Venta en Septiembre
      { side: 'SELL', price: 61000, amount: 0.1, fee: 2.28, updatedAt: new Date('2026-09-01T05:00:00Z') },
    ];

    const statsMap = calculateContinuousMonthlyStats(mockFills);

    // Agosto: Compra (no realiza profit, paga fee)
    const augStats = statsMap.get('2026-8')!;
    expect(augStats.netProfitUsd).toBe(-2.25);
    expect(augStats.totalTrades).toBe(1);

    // Septiembre: Venta cerrando compra de Agosto (Spread = +100 USD, Fee = 2.28 -> Net = +97.72 USD)
    const sepStats = statsMap.get('2026-9')!;
    expect(sepStats.netProfitUsd).toBe(97.72);
    expect(sepStats.totalTrades).toBe(1);
  });

  it('debe devolver mapa vacío si no hay fills', () => {
    const statsMap = calculateContinuousMonthlyStats([]);
    expect(statsMap.size).toBe(0);
  });
});
