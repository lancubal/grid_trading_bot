import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { GridConfigInput } from '../config';
import { GridLevel, OrderExecutionEvent } from '../types';

export interface SeedOrderPlan {
  levelIndex: number;
  price: Decimal;
  side: 'buy' | 'sell';
  amount: Decimal;
}

export class GridManager extends EventEmitter {
  private config: GridConfigInput;
  private levels: GridLevel[] = [];
  private stepSize: Decimal;
  private consecutiveUpperBreaches: number = 0;
  private readonly breachThreshold: number;

  constructor(config: GridConfigInput, breachThreshold: number = 4) {
    super();
    this.config = config;
    this.breachThreshold = breachThreshold;
    this.stepSize = this.calculateStepSize();
    this.initGridLevels();
  }

  public getConfig(): Readonly<GridConfigInput> {
    return this.config;
  }

  /**
   * Distancia entre cada nivel de precio de la grilla
   */
  private calculateStepSize(): Decimal {
    const lower = new Decimal(this.config.lowerPrice);
    const upper = new Decimal(this.config.upperPrice);
    const range = upper.minus(lower);
    const intervals = new Decimal(this.config.gridLevels - 1);
    return range.dividedBy(intervals);
  }

  /**
   * Inicializa la cuadrícula de precios estática
   */
  private initGridLevels(): void {
    this.levels = [];
    const lower = new Decimal(this.config.lowerPrice);
    for (let i = 0; i < this.config.gridLevels; i++) {
      const levelPrice = lower.plus(this.stepSize.times(i));
      this.levels.push({
        levelIndex: i,
        price: levelPrice,
        state: 'empty',
      });
    }
  }

  public getLevels(): ReadonlyArray<GridLevel> {
    return this.levels;
  }

  public getStepSize(): Decimal {
    return this.stepSize;
  }

  /**
   * Re-dibuja la grilla centrada en un nuevo precio de mercado (Trailing Up)
   */
  public rebalanceGrid(newCenterPrice: Decimal): { newLowerPrice: Decimal; newUpperPrice: Decimal } {
    const totalRange = this.config.upperPrice.minus(this.config.lowerPrice);
    const halfRange = totalRange.dividedBy(2);

    const newLowerPrice = newCenterPrice.minus(halfRange);
    const newUpperPrice = newCenterPrice.plus(halfRange);

    this.config = {
      ...this.config,
      lowerPrice: newLowerPrice,
      upperPrice: newUpperPrice,
    };

    this.stepSize = this.calculateStepSize();
    this.initGridLevels();
    this.consecutiveUpperBreaches = 0;

    console.log(`[GridManager] 🚀 TRAILING UP: Grilla re-centrada en $${newCenterPrice.toFixed(2)} USD (Nuevo Rango: $${newLowerPrice.toFixed(2)} - $${newUpperPrice.toFixed(2)})`);

    this.emit('grid:rebalanced', {
      symbol: this.config.symbol,
      lowerPrice: newLowerPrice,
      upperPrice: newUpperPrice,
    });

    return { newLowerPrice, newUpperPrice };
  }

  /**
   * Monitorea si el precio rompe el techo de la grilla y se consolida por N cierres consecutivos
   */
  public checkTrailingUp(closePrice: Decimal): boolean {
    const priceDec = new Decimal(closePrice);

    if (priceDec.greaterThan(this.config.upperPrice)) {
      this.consecutiveUpperBreaches++;
      console.log(`[GridManager Trailing] RUPTURA DE TECHO (${this.consecutiveUpperBreaches}/${this.breachThreshold}) @ $${priceDec.toFixed(2)}`);

      if (this.consecutiveUpperBreaches >= this.breachThreshold) {
        this.rebalanceGrid(priceDec);
        return true;
      }
    } else {
      this.consecutiveUpperBreaches = 0;
    }

    return false;
  }

  /**
   * Calcula el plan de siembra inicial de órdenes (Buy Limits por debajo del precio actual, Sell Limits por encima)
   */
  public generateSeedOrders(currentMarketPrice: Decimal | number | string): SeedOrderPlan[] {
    const seedOrders: SeedOrderPlan[] = [];
    const currentPriceDec = new Decimal(currentMarketPrice);
    const investmentDec = new Decimal(this.config.investment);
    const budgetPerLevel = investmentDec.dividedBy(this.config.gridLevels - 1);

    for (const level of this.levels) {
      const levelPriceDec = new Decimal(level.price);

      if (levelPriceDec.lessThan(currentPriceDec)) {
        const amount = budgetPerLevel.dividedBy(levelPriceDec);
        seedOrders.push({
          levelIndex: level.levelIndex,
          price: levelPriceDec,
          side: 'buy',
          amount: amount.toDecimalPlaces(6, Decimal.ROUND_DOWN),
        });
      } else if (levelPriceDec.greaterThan(currentPriceDec)) {
        const amount = budgetPerLevel.dividedBy(levelPriceDec);
        seedOrders.push({
          levelIndex: level.levelIndex,
          price: levelPriceDec,
          side: 'sell',
          amount: amount.toDecimalPlaces(6, Decimal.ROUND_DOWN),
        });
      }
    }

    return seedOrders;
  }

  /**
   * Procesa un Fill de orden y calcula la contra-orden ("Flip")
   */
  public handleOrderFill(event: OrderExecutionEvent): SeedOrderPlan | null {
    if (event.gridLevel === undefined || event.gridLevel < 0 || event.gridLevel >= this.levels.length) {
      console.warn(`[GridManager] Fill ignorado: Nivel de grilla no válido (${event.gridLevel})`);
      return null;
    }

    const fillAmountDec = new Decimal(event.amount);

    if (event.side === 'buy') {
      const targetLevelIndex = event.gridLevel + 1;
      if (targetLevelIndex < this.levels.length) {
        const targetPrice = new Decimal(this.levels[targetLevelIndex].price);
        const flipPlan: SeedOrderPlan = {
          levelIndex: targetLevelIndex,
          price: targetPrice,
          side: 'sell',
          amount: fillAmountDec,
        };
        this.emit('grid:flip_required', flipPlan);
        return flipPlan;
      }
    } else if (event.side === 'sell') {
      const targetLevelIndex = event.gridLevel - 1;
      if (targetLevelIndex >= 0) {
        const targetPrice = new Decimal(this.levels[targetLevelIndex].price);
        const flipPlan: SeedOrderPlan = {
          levelIndex: targetLevelIndex,
          price: targetPrice,
          side: 'buy',
          amount: fillAmountDec,
        };
        this.emit('grid:flip_required', flipPlan);
        return flipPlan;
      }
    }

    return null;
  }
}
