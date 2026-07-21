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

  constructor(config: GridConfigInput) {
    super();
    this.config = config;
    this.stepSize = this.calculateStepSize();
    this.initGridLevels();
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
   * Calcula el plan de siembra inicial de órdenes (Buy Limits por debajo del precio actual, Sell Limits por encima)
   * @param currentMarketPrice Precio de mercado actual (BTC/USDT)
   */
  public generateSeedOrders(currentMarketPrice: Decimal | number | string): SeedOrderPlan[] {
    const seedOrders: SeedOrderPlan[] = [];
    const currentPriceDec = new Decimal(currentMarketPrice);
    const investmentDec = new Decimal(this.config.investment);
    const budgetPerLevel = investmentDec.dividedBy(this.config.gridLevels - 1);

    for (const level of this.levels) {
      const levelPriceDec = new Decimal(level.price);

      if (levelPriceDec.lessThan(currentPriceDec)) {
        // Nivel por debajo del precio actual: Orden de COMPRA
        const amount = budgetPerLevel.dividedBy(levelPriceDec);
        seedOrders.push({
          levelIndex: level.levelIndex,
          price: levelPriceDec,
          side: 'buy',
          amount: amount.toDecimalPlaces(6, Decimal.ROUND_DOWN),
        });
      } else if (levelPriceDec.greaterThan(currentPriceDec)) {
        // Nivel por encima del precio actual: Orden de VENTA
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
