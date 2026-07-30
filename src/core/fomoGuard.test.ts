import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Decimal from 'decimal.js';
import { FomoGuard } from './fomoGuard';

describe('FomoGuard - Anti-Buying Peak Protection Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no debe bloquear el recentrado si el precio está dentro del techo de la grilla', () => {
    const fomoGuard = new FomoGuard({ cooldownHours: 4.0 });

    const check = fomoGuard.checkFomoRisk(65500, 66000); // $65,500 <= $66,000
    expect(check.isBlocked).toBe(false);
    expect(check.justBlocked).toBe(false);
  });

  it('debe disparar justBlocked = true cuando el precio rompe el techo de la grilla (Pump)', () => {
    const fomoGuard = new FomoGuard({ cooldownHours: 4.0 });

    const check = fomoGuard.checkFomoRisk(67500, 66000); // $67,500 > $66,000

    expect(check.isBlocked).toBe(true);
    expect(check.justBlocked).toBe(true);
    expect(check.message).toContain('PUMP DETECTADO');
    expect(check.remainingMinutes).toBe(240);
  });

  it('debe mantener el bloqueo durante las 4 horas de Cooldown', () => {
    const fomoGuard = new FomoGuard({ cooldownHours: 4.0 });

    fomoGuard.checkFomoRisk(67500, 66000); // Disparo

    vi.advanceTimersByTime(2 * 3600 * 1000); // Avanzar 2 horas
    const checkMidCooldown = fomoGuard.checkFomoRisk(66500, 66000);

    expect(checkMidCooldown.isBlocked).toBe(true);
    expect(checkMidCooldown.justBlocked).toBe(false);
    expect(checkMidCooldown.remainingMinutes).toBe(120);
  });

  it('debe liberar el bloqueo automáticamente una vez transcurridas las 4 horas', () => {
    const fomoGuard = new FomoGuard({ cooldownHours: 4.0 });

    fomoGuard.checkFomoRisk(67500, 66000); // Disparo

    vi.advanceTimersByTime(4 * 3600 * 1000 + 1000); // Avanzar 4 horas y 1 seg
    const checkAfterCooldown = fomoGuard.checkFomoRisk(65000, 66000); // Precio dentro de rango aceptable

    expect(checkAfterCooldown.isBlocked).toBe(false);
    expect(checkAfterCooldown.justBlocked).toBe(false);
  });
});
