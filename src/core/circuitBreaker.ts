import Decimal from 'decimal.js';

export interface CircuitBreakerConfig {
  dropThresholdPct: number; // e.g. 5.0 para 5% de caída
  windowMins: number; // e.g. 15 minutos
  cooldownHours: number; // e.g. 2 horas
}

export interface CircuitBreakerHealthCheck {
  isTripped: boolean;
  justTripped: boolean;
  message?: string;
  remainingMinutes?: number;
}

export class CircuitBreaker {
  private priceHistory: { price: Decimal; timestamp: number }[] = [];
  private trippedUntil: number = 0;
  private isCurrentlyTripped: boolean = false;

  private dropThresholdPct: Decimal;
  private timeWindowMs: number;
  private cooldownMs: number;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    const dropPct = config?.dropThresholdPct ?? 5.0;
    this.dropThresholdPct = new Decimal(dropPct).dividedBy(100);
    this.timeWindowMs = (config?.windowMins ?? 15) * 60 * 1000;
    this.cooldownMs = (config?.cooldownHours ?? 2) * 60 * 60 * 1000;
  }

  public getStatus(): { isTripped: boolean; remainingMinutes: number } {
    const now = Date.now();
    if (now < this.trippedUntil) {
      const remainingMinutes = Math.ceil((this.trippedUntil - now) / 60000);
      return { isTripped: true, remainingMinutes };
    }
    return { isTripped: false, remainingMinutes: 0 };
  }

  public reset(): void {
    this.trippedUntil = 0;
    this.isCurrentlyTripped = false;
    this.priceHistory = [];
  }

  public checkMarketHealth(currentPriceInput: number | Decimal): CircuitBreakerHealthCheck {
    const now = Date.now();
    const currentPrice = new Decimal(currentPriceInput);

    // 1. Si el cortacircuitos ya está activo
    if (now < this.trippedUntil) {
      const remainingMinutes = Math.ceil((this.trippedUntil - now) / 60000);
      return {
        isTripped: true,
        justTripped: false,
        remainingMinutes,
        message: `Cortacircuitos activo. Compras pausadas. Restan ${remainingMinutes} min.`,
      };
    }

    // Si expiró el cooldown
    if (this.isCurrentlyTripped && now >= this.trippedUntil) {
      console.log('[CircuitBreaker] 🟢 Cooldown finalizado. El cortacircuitos vuelve a estado NORMAL.');
      this.isCurrentlyTripped = false;
      this.priceHistory = [];
    }

    // 2. Registrar el nuevo precio y filtrar ventana temporal de 15 min
    this.priceHistory.push({ price: currentPrice, timestamp: now });
    this.priceHistory = this.priceHistory.filter((p) => now - p.timestamp <= this.timeWindowMs);

    // 3. Evaluar la velocidad de caída
    if (this.priceHistory.length > 0) {
      const oldestPrice = this.priceHistory[0].price;
      if (oldestPrice.greaterThan(0)) {
        const dropRatio = oldestPrice.minus(currentPrice).dividedBy(oldestPrice);

        // 4. Disparar si la caída excede el umbral (ej. >= 5%)
        if (dropRatio.greaterThanOrEqualTo(this.dropThresholdPct)) {
          this.trippedUntil = now + this.cooldownMs;
          this.isCurrentlyTripped = true;
          this.priceHistory = [];

          const dropPctStr = dropRatio.times(100).toFixed(2);
          const msg = `🚨 FLASH CRASH DETECTADO: Caída del ${dropPctStr}% en 15m. Cortacircuitos activado: Compras pausadas por ${Math.round(this.cooldownMs / 3600000)} horas.`;

          console.warn(`[CircuitBreaker Alert] ${msg}`);

          return {
            isTripped: true,
            justTripped: true,
            message: msg,
            remainingMinutes: Math.round(this.cooldownMs / 60000),
          };
        }
      }
    }

    return { isTripped: false, justTripped: false };
  }
}
