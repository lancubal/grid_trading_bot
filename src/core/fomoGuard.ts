import Decimal from 'decimal.js';

export interface FomoGuardConfig {
  cooldownHours: number; // default 4.0 horas
}

export interface FomoGuardCheckResult {
  isBlocked: boolean;
  justBlocked: boolean;
  message?: string;
  remainingMinutes?: number;
}

export class FomoGuard {
  private blockedUntil: number = 0;
  private isCurrentlyBlocked: boolean = false;
  private cooldownMs: number;

  constructor(config?: Partial<FomoGuardConfig>) {
    const hours = config?.cooldownHours ?? 4.0;
    this.cooldownMs = hours * 60 * 60 * 1000;
  }

  public getStatus(): { isBlocked: boolean; remainingMinutes: number } {
    const now = Date.now();
    if (now < this.blockedUntil) {
      const remainingMinutes = Math.ceil((this.blockedUntil - now) / 60000);
      return { isBlocked: true, remainingMinutes };
    }
    return { isBlocked: false, remainingMinutes: 0 };
  }

  public reset(): void {
    this.blockedUntil = 0;
    this.isCurrentlyBlocked = false;
  }

  public checkFomoRisk(
    currentPriceInput: number | Decimal,
    highestGridLevelInput: number | Decimal
  ): FomoGuardCheckResult {
    const now = Date.now();
    const currentPrice = new Decimal(currentPriceInput);
    const highestGridLevel = new Decimal(highestGridLevelInput);

    // 1. Si el sistema ya está en período de enfriamiento FOMO
    if (now < this.blockedUntil) {
      const remainingMinutes = Math.ceil((this.blockedUntil - now) / 60000);
      return {
        isBlocked: true,
        justBlocked: false,
        remainingMinutes,
        message: `⏳ Bloqueo FOMO activo. Esperando estabilización del mercado: restan ${remainingMinutes} min.`,
      };
    }

    // Restablecer si el cooldown ya venció
    if (this.isCurrentlyBlocked && now >= this.blockedUntil) {
      console.log('[FomoGuard] 🟢 Cooldown FOMO finalizado. Mercado consolidado, recentrado liberado.');
      this.isCurrentlyBlocked = false;
    }

    // 2. Si el precio actual rompe con fuerza (> 1.5%) el techo de la grilla (Pump parabólico real)
    const pumpThreshold = highestGridLevel.times(1.015);
    if (highestGridLevel.greaterThan(0) && currentPrice.greaterThan(pumpThreshold)) {
      this.blockedUntil = now + this.cooldownMs;
      this.isCurrentlyBlocked = true;

      const remainingMins = Math.round(this.cooldownMs / 60000);
      const msg = `🚀 PUMP DETECTADO: El precio ($${currentPrice.toFixed(2)}) rompió por más de 1.5% el techo de la grilla ($${highestGridLevel.toFixed(2)}). Bloqueando recentrado por ${Math.round(this.cooldownMs / 3600000)} horas para no comprar la cima.`;

      console.warn(`[FomoGuard Alert] ${msg}`);

      return {
        isBlocked: true,
        justBlocked: true,
        remainingMinutes: remainingMins,
        message: msg,
      };
    }

    return { isBlocked: false, justBlocked: false };
  }
}
