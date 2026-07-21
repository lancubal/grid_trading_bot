import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { RiskGuard } from './riskGuard';

describe('RiskGuard - Risk Management & Maker Enforcement Tests', () => {
  it('debe aprobar órdenes LIMIT con montos válidos dentro del límite', () => {
    const riskGuard = new RiskGuard(new Decimal('150'), 20);

    const validOrder = {
      symbol: 'BTC/USDT',
      type: 'limit' as const,
      side: 'buy' as const,
      amount: new Decimal('0.001'),
      price: new Decimal('64000'), // Valor total = $64 USD
    };

    const result = riskGuard.validateOrder(validOrder, 5);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('debe rechazar órdenes que no sean de tipo LIMIT (ej. MARKET / Taker)', () => {
    const riskGuard = new RiskGuard();

    const marketOrder = {
      symbol: 'BTC/USDT',
      type: 'market' as const,
      side: 'buy' as const,
      amount: new Decimal('0.001'),
    };

    const result = riskGuard.validateOrder(marketOrder, 5);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Solo se permiten órdenes de tipo LIMIT (Maker)');
  });

  it('debe rechazar órdenes LIMIT sin precio o con precio cero', () => {
    const riskGuard = new RiskGuard();

    const zeroPriceOrder = {
      symbol: 'BTC/USDT',
      type: 'limit' as const,
      side: 'buy' as const,
      amount: new Decimal('0.001'),
      price: new Decimal(0),
    };

    const result = riskGuard.validateOrder(zeroPriceOrder, 5);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Las órdenes LIMIT requieren especificar un precio válido');
  });

  it('debe rechazar órdenes cuyo valor en USD supere el límite de riesgo ($150.00)', () => {
    const riskGuard = new RiskGuard(new Decimal('150'), 20);

    const expensiveOrder = {
      symbol: 'BTC/USDT',
      type: 'limit' as const,
      side: 'buy' as const,
      amount: new Decimal('0.01'),
      price: new Decimal('64000'), // Valor total = $640 USD (supera $150)
    };

    const result = riskGuard.validateOrder(expensiveOrder, 2);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('supera el límite de riesgo');
  });

  it('debe rechazar órdenes si se alcanza el máximo de órdenes abiertas', () => {
    const riskGuard = new RiskGuard(new Decimal('150'), 10);

    const order = {
      symbol: 'BTC/USDT',
      type: 'limit' as const,
      side: 'buy' as const,
      amount: new Decimal('0.001'),
      price: new Decimal('64000'),
    };

    const result = riskGuard.validateOrder(order, 10);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Límite máximo de órdenes abiertas alcanzado');
  });
});
