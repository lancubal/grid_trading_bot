import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Decimal from 'decimal.js';
import { CircuitBreaker } from './circuitBreaker';

describe('CircuitBreaker - Flash Crash Protection Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no debe dispararse ante caídas menores al umbral (ej. 2% en 15m)', () => {
    const breaker = new CircuitBreaker({ dropThresholdPct: 5.0, windowMins: 15, cooldownHours: 2 });

    const check1 = breaker.checkMarketHealth(65000);
    expect(check1.isTripped).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000); // Avanzar 5 min
    const check2 = breaker.checkMarketHealth(63700); // -2% de caída
    expect(check2.isTripped).toBe(false);
  });

  it('debe disparar justTripped = true ante una caída del 5% o más en menos de 15 minutos', () => {
    const breaker = new CircuitBreaker({ dropThresholdPct: 5.0, windowMins: 15, cooldownHours: 2 });

    breaker.checkMarketHealth(65000);

    vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutos después
    const check2 = breaker.checkMarketHealth(61500); // Caída de ~5.38%

    expect(check2.isTripped).toBe(true);
    expect(check2.justTripped).toBe(true);
    expect(check2.message).toContain('FLASH CRASH DETECTADO');
  });

  it('debe mantener isTripped = true y justTripped = false durante el período de Cooldown de 2 horas', () => {
    const breaker = new CircuitBreaker({ dropThresholdPct: 5.0, windowMins: 15, cooldownHours: 2 });

    breaker.checkMarketHealth(65000);
    breaker.checkMarketHealth(61000); // Disparo

    vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutos después
    const checkDuringCooldown = breaker.checkMarketHealth(60500);

    expect(checkDuringCooldown.isTripped).toBe(true);
    expect(checkDuringCooldown.justTripped).toBe(false);
    expect(checkDuringCooldown.remainingMinutes).toBe(90);
  });

  it('debe restablecer el estado a NORMAL una vez transcurridas las 2 horas de Cooldown', () => {
    const breaker = new CircuitBreaker({ dropThresholdPct: 5.0, windowMins: 15, cooldownHours: 2 });

    breaker.checkMarketHealth(65000);
    breaker.checkMarketHealth(61000); // Disparo

    vi.advanceTimersByTime(2 * 3600 * 1000 + 1000); // 2 horas y 1 seg después
    const checkAfterCooldown = breaker.checkMarketHealth(61200);

    expect(checkAfterCooldown.isTripped).toBe(false);
    expect(checkAfterCooldown.justTripped).toBe(false);
  });
});
