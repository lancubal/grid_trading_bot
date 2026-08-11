import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { PriceDriftGuard } from './priceDriftGuard';

describe('PriceDriftGuard - Proactive Grid Drift Protection Unit Tests', () => {
  it('debe retornar isDrifting = false cuando el precio está en el centro de la grilla (50%)', () => {
    const guard = new PriceDriftGuard(0.80, 0.20, 15);
    const lower = new Decimal(60000);
    const upper = new Decimal(64000); // Rango $4000
    const price = new Decimal(62000); // 50% del rango

    const status = guard.checkDrift(price, lower, upper);
    expect(status.isDrifting).toBe(false);
    expect(status.direction).toBe('none');
    expect(status.relativePositionPct).toBe(50);
  });

  it('debe disparar isDrifting = true (upper) cuando el precio alcanza o supera el 80% del rango', () => {
    const guard = new PriceDriftGuard(0.80, 0.20, 15);
    const lower = new Decimal(60000);
    const upper = new Decimal(64000);
    const price = new Decimal(63200); // 80% del rango ($60000 + 0.8 * $4000 = $63200)

    const status = guard.checkDrift(price, lower, upper);
    expect(status.isDrifting).toBe(true);
    expect(status.direction).toBe('upper');
    expect(status.relativePositionPct).toBe(80);
    expect(status.message).toContain('Deriva Alcista detectada');
  });

  it('debe disparar isDrifting = true (lower) cuando el precio cae al 20% o menos del rango', () => {
    const guard = new PriceDriftGuard(0.80, 0.20, 15);
    const lower = new Decimal(60000);
    const upper = new Decimal(64000);
    const price = new Decimal(60800); // 20% del rango ($60000 + 0.2 * $4000 = $60800)

    const status = guard.checkDrift(price, lower, upper);
    expect(status.isDrifting).toBe(true);
    expect(status.direction).toBe('lower');
    expect(status.relativePositionPct).toBe(20);
    expect(status.message).toContain('Deriva Bajista detectada');
  });

  it('debe respetar el Cooldown de 15 minutos tras registrar un trigger', () => {
    const guard = new PriceDriftGuard(0.80, 0.20, 15);
    const lower = new Decimal(60000);
    const upper = new Decimal(64000);
    const price = new Decimal(63500); // 87.5% del rango

    const startTime = 1000000000000;
    const status1 = guard.checkDrift(price, lower, upper, startTime);
    expect(status1.isDrifting).toBe(true);

    guard.recordTrigger(startTime);

    // Intentar 5 minutos después (dentro del cooldown de 15m = 900,000ms)
    const fiveMinsLater = startTime + 5 * 60 * 1000;
    const status2 = guard.checkDrift(price, lower, upper, fiveMinsLater);
    expect(status2.isDrifting).toBe(false);

    // Intentar 16 minutos después (fuera del cooldown)
    const sixteenMinsLater = startTime + 16 * 60 * 1000;
    const status3 = guard.checkDrift(price, lower, upper, sixteenMinsLater);
    expect(status3.isDrifting).toBe(true);
  });
});
