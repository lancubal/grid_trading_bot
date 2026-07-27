import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { RiskGuard } from './riskGuard';

describe('RiskGuard - Risk Management & Maker Enforcement Tests', () => {
  it('debe aprobar órdenes LIMIT con montos válidos dentro del límite', () => {
    const riskGuard = new RiskGuard(new Decimal('150'), 20, new Decimal('2000'));

    const validOrder = {
      symbol: 'BTC/USDT',
      type: 'limit' as const,
      side: 'buy' as const,
      amount: new Decimal('0.001'),
      price: new Decimal('64000'), // Valor total = $64 USD
    };

    const result = riskGuard.validateOrder(validOrder, 5, new Decimal('500'));
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

  it('debe rechazar órdenes cuyo valor en USD supere el límite individual de riesgo ($150.00)', () => {
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
    expect(result.reason).toContain('supera el límite individual de riesgo');
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

  it('debe rechazar órdenes si la asignación total proyectada supera el blindaje de capital (MAX_GRID_ALLOCATION_USD)', () => {
    const riskGuard = new RiskGuard(new Decimal('150'), 20, new Decimal('2000'));

    const order = {
      symbol: 'BTC/USDT',
      type: 'limit' as const,
      side: 'buy' as const,
      amount: new Decimal('0.002'),
      price: new Decimal('64000'), // Valor total = $128 USD
    };

    // Asignación actual = $1,900 USD. Proyectada = $2,028 USD (supera $2,000)
    const result = riskGuard.validateOrder(order, 5, new Decimal('1900'));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Blindaje de Capital');
  });

  describe('Firewall de Autodefensa de Capital (Alerta de Sed - Reglas A, B y C)', () => {
    const riskGuard = new RiskGuard();

    it('Regla A: debe aprobar inyección si disponible < $150 USDT y transcurrieron 20+ días', () => {
      const res = riskGuard.validateAutoInjection({
        currentUsdtCash: 120, // Saldo < $150
        lastInjectionTimestamp: new Date(Date.now() - 21 * 24 * 3600 * 1000), // Hace 21 días
        currentLifetimeAllocationUsd: 2000,
        maxLifetimeAllocationUsd: 10000,
        autoInjectAmountUsd: 1000,
      });

      expect(res.valid).toBe(true);
    });

    it('Regla A: debe rechazar inyección si disponible >= $150 USDT y no hay error de fondos', () => {
      const res = riskGuard.validateAutoInjection({
        currentUsdtCash: 500, // Saldo > $150
        isInsufficientFunds: false,
        currentLifetimeAllocationUsd: 2000,
      });

      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Regla A');
    });

    it('Regla B: debe rechazar inyección si transcurrieron menos de 20 días desde la última inyección', () => {
      const res = riskGuard.validateAutoInjection({
        currentUsdtCash: 50,
        lastInjectionTimestamp: new Date(Date.now() - 5 * 24 * 3600 * 1000), // Hace 5 días (faltan 15)
        autoInjectCooldownDays: 20,
        currentLifetimeAllocationUsd: 2000,
      });

      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Regla B (Cooldown Estricto)');
    });

    it('Regla C: debe rechazar inyección si la inyección proyectada superaría el techo patrimonial (MAX_LIFETIME_ALLOCATION_USD)', () => {
      const res = riskGuard.validateAutoInjection({
        currentUsdtCash: 50,
        lastInjectionTimestamp: null,
        currentLifetimeAllocationUsd: 9500,
        autoInjectAmountUsd: 1000,
        maxLifetimeAllocationUsd: 10000, // 9500 + 1000 = 10500 > 10000
      });

      expect(res.valid).toBe(false);
      expect(res.reason).toContain('Regla C (Techo Patrimonial Inviolable)');
    });
  });
});
