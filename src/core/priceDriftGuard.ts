import Decimal from 'decimal.js';

export interface PriceDriftStatus {
  isDrifting: boolean;
  direction: 'upper' | 'lower' | 'none';
  relativePositionPct: number;
  message?: string;
}

export class PriceDriftGuard {
  private readonly upperThresholdRatio: Decimal;
  private readonly lowerThresholdRatio: Decimal;
  private readonly cooldownMs: number;
  private lastTriggerTime: number = 0;

  constructor(
    upperThresholdRatio: number = 0.80,
    lowerThresholdRatio: number = 0.20,
    cooldownMinutes: number = 15
  ) {
    this.upperThresholdRatio = new Decimal(upperThresholdRatio);
    this.lowerThresholdRatio = new Decimal(lowerThresholdRatio);
    this.cooldownMs = cooldownMinutes * 60 * 1000;
  }

  public getCooldownMs(): number {
    return this.cooldownMs;
  }

  public getLastTriggerTime(): number {
    return this.lastTriggerTime;
  }

  /**
   * Evalúa la posición relativa del precio actual respecto al rango [lowerPrice, upperPrice]
   */
  public checkDrift(
    currentPrice: Decimal | number | string,
    lowerPrice: Decimal | number | string,
    upperPrice: Decimal | number | string,
    now: number = Date.now()
  ): PriceDriftStatus {
    const priceDec = new Decimal(currentPrice);
    const lowerDec = new Decimal(lowerPrice);
    const upperDec = new Decimal(upperPrice);

    const range = upperDec.minus(lowerDec);
    if (range.lessThanOrEqualTo(0)) {
      return { isDrifting: false, direction: 'none', relativePositionPct: 50 };
    }

    const relativePos = priceDec.minus(lowerDec).dividedBy(range);
    const relativePosPct = relativePos.times(100).toNumber();

    if (this.lastTriggerTime > 0 && now - this.lastTriggerTime < this.cooldownMs) {
      return { isDrifting: false, direction: 'none', relativePositionPct: relativePosPct };
    }

    if (relativePos.greaterThanOrEqualTo(this.upperThresholdRatio)) {
      return {
        isDrifting: true,
        direction: 'upper',
        relativePositionPct: relativePosPct,
        message: `Deriva Alcista detectada: El precio ($${priceDec.toFixed(2)}) alcanzó el ${relativePosPct.toFixed(1)}% del rango (>= ${(this.upperThresholdRatio.toNumber() * 100).toFixed(0)}%). Acercándose al techo ($${upperDec.toFixed(2)} USD).`,
      };
    }

    if (relativePos.lessThanOrEqualTo(this.lowerThresholdRatio)) {
      return {
        isDrifting: true,
        direction: 'lower',
        relativePositionPct: relativePosPct,
        message: `Deriva Bajista detectada: El precio ($${priceDec.toFixed(2)}) cayó al ${relativePosPct.toFixed(1)}% del rango (<= ${(this.lowerThresholdRatio.toNumber() * 100).toFixed(0)}%). Acercándose al piso ($${lowerDec.toFixed(2)} USD).`,
      };
    }

    return { isDrifting: false, direction: 'none', relativePositionPct: relativePosPct };
  }

  public recordTrigger(now: number = Date.now()): void {
    this.lastTriggerTime = now;
  }

  public reset(): void {
    this.lastTriggerTime = 0;
  }
}
