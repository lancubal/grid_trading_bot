import { EventEmitter } from 'events';
import Decimal from 'decimal.js';

export type MarketRegime = 'BULL' | 'CRAB' | 'BEAR';

export interface RegimeState {
  regime: MarketRegime;
  regimeScorePct: number;
  emaFast24h: Decimal;
  emaSlow96h: Decimal;
  lastUpdated: Date;
}

export class LiveRegimeOrchestrator extends EventEmitter {
  private emaFast: Decimal = new Decimal(0);
  private emaSlow: Decimal = new Decimal(0);
  private alphaFast: Decimal = new Decimal(2).dividedBy(24 + 1); // 24h EMA
  private alphaSlow: Decimal = new Decimal(2).dividedBy(96 + 1); // 96h EMA
  private thresholdPct: Decimal;
  private currentRegime: MarketRegime = 'CRAB';
  private isInitialized: boolean = false;

  constructor(thresholdPct: number = 1.09) {
    super();
    this.thresholdPct = new Decimal(thresholdPct);
  }

  public update1hClose(closePrice: Decimal | number | string): RegimeState {
    const price = new Decimal(closePrice);

    if (!this.isInitialized) {
      this.emaFast = price;
      this.emaSlow = price;
      this.isInitialized = true;
    } else {
      this.emaFast = this.alphaFast.times(price).plus(new Decimal(1).minus(this.alphaFast).times(this.emaFast));
      this.emaSlow = this.alphaSlow.times(price).plus(new Decimal(1).minus(this.alphaSlow).times(this.emaSlow));
    }

    let scorePct = new Decimal(0);
    if (this.emaSlow.greaterThan(0)) {
      scorePct = this.emaFast.minus(this.emaSlow).dividedBy(this.emaSlow).times(100);
    }

    let nextRegime: MarketRegime = 'CRAB';
    if (scorePct.greaterThanOrEqualTo(this.thresholdPct)) {
      nextRegime = 'BULL';
    } else if (scorePct.lessThanOrEqualTo(this.thresholdPct.negated())) {
      nextRegime = 'BEAR';
    } else {
      nextRegime = 'CRAB';
    }

    if (nextRegime !== this.currentRegime) {
      console.log(
        `[RegimeOrchestrator] 🎛️ CAMBIO DE RÉGIMEN DE MERCADO: ${this.currentRegime} ➔ ${nextRegime} (Score: ${scorePct.toFixed(2)}% | Umbral: ±${this.thresholdPct.toFixed(2)}%)`
      );
      this.currentRegime = nextRegime;
      this.emit('regime:changed', {
        previousRegime: this.currentRegime,
        newRegime: nextRegime,
        regimeScorePct: scorePct.toNumber(),
      });
    }

    return {
      regime: this.currentRegime,
      regimeScorePct: scorePct.toNumber(),
      emaFast24h: this.emaFast,
      emaSlow96h: this.emaSlow,
      lastUpdated: new Date(),
    };
  }

  public getRegime(): MarketRegime {
    return this.currentRegime;
  }
}
