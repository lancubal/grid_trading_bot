import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { GridConfigInput } from '../config';
import { GridLevel, OrderExecutionEvent } from '../types';
import { AtrCalculator } from './atrCalculator';

export interface SeedOrderPlan {
  levelIndex: number;
  price: Decimal;
  side: 'buy' | 'sell';
  amount: Decimal;
  layer?: 'micro' | 'macro';
}

export interface LegacyOrder {
  orderId?: string;
  price: Decimal;
  amount: Decimal;
}

export class GridManager extends EventEmitter {
  private config: GridConfigInput;
  private levels: GridLevel[] = [];
  private stepSize: Decimal;
  private legacyVault: LegacyOrder[] = [];

  constructor(config: GridConfigInput) {
    super();
    this.config = config;
    this.stepSize = this.calculateStepSize();
    this.initGridLevels();
  }

  public getConfig(): Readonly<GridConfigInput> {
    return this.config;
  }

  public updateInvestment(newInvestment: Decimal | number | string): void {
    this.config = {
      ...this.config,
      investment: new Decimal(newInvestment),
    };
  }

  public getLegacyVault(): ReadonlyArray<LegacyOrder> {
    return this.legacyVault;
  }

  public addLegacyOrder(order: LegacyOrder): void {
    this.legacyVault.push(order);
    console.log(
      `[GridManager LegacyVault] 🛡️ Orden archivada en Bóveda Legacy a $${order.price.toFixed(2)} USD (${order.amount.toFixed(6)} BTC) - Cero venta a pérdida.`
    );
  }

  public checkLegacyFills(highPrice: Decimal | number | string): LegacyOrder[] {
    const high = new Decimal(highPrice);
    const executed: LegacyOrder[] = [];
    this.legacyVault = this.legacyVault.filter((order) => {
      if (high.greaterThanOrEqualTo(order.price)) {
        executed.push(order);
        console.log(
          `[GridManager LegacyVault] 🎯 ORDEN LEGACY EJECUTADA a $${order.price.toFixed(2)} USD (${order.amount.toFixed(6)} BTC). Liquidez recuperada.`
        );
        return false;
      }
      return true;
    });
    return executed;
  }

  private calculateStepSize(): Decimal {
    const lower = new Decimal(this.config.lowerPrice);
    const upper = new Decimal(this.config.upperPrice);
    const range = upper.minus(lower);
    const intervals = new Decimal(this.config.gridLevels - 1);
    return range.dividedBy(intervals);
  }

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

  public adjustToVolatility(
    atr: Decimal,
    currentMarketPrice: Decimal,
    multiplier: number = 2.0,
    minRange: number = 6996,
    maxRange: number = 8846
  ): { newLowerPrice: Decimal; newUpperPrice: Decimal; dynamicRange: Decimal; stepSize: Decimal } {
    const mult = this.config.atrMultiplier || multiplier;
    const minR = this.config.minGridRangeUsd ? this.config.minGridRangeUsd.toNumber() : minRange;
    const maxR = this.config.maxGridRangeUsd ? this.config.maxGridRangeUsd.toNumber() : maxRange;

    const dynamicRange = AtrCalculator.calculateDynamicRange(atr, mult, minR, maxR);
    const halfRange = dynamicRange.dividedBy(2);

    const newLowerPrice = currentMarketPrice.minus(halfRange);
    const newUpperPrice = currentMarketPrice.plus(halfRange);

    this.config = {
      ...this.config,
      lowerPrice: newLowerPrice,
      upperPrice: newUpperPrice,
    };

    this.stepSize = this.calculateStepSize();
    this.initGridLevels();

    console.log(
      `[GridManager ATR] 📈 Volatilidad ATR (${atr.toFixed(2)} USD): Rango adaptado a $${dynamicRange.toFixed(2)} USD (Piso: $${newLowerPrice.toFixed(2)} - Techo: $${newUpperPrice.toFixed(2)} | Escalón: $${this.stepSize.toFixed(2)})`
    );

    this.emit('grid:rebalanced', {
      symbol: this.config.symbol,
      lowerPrice: newLowerPrice,
      upperPrice: newUpperPrice,
      dynamicRange,
      stepSize: this.stepSize,
    });

    return { newLowerPrice, newUpperPrice, dynamicRange, stepSize: this.stepSize };
  }

  public generateSeedOrders(
    currentMarketPrice: Decimal | number | string,
    holdingCostBasis: Decimal[] = [],
    availableUsdt?: Decimal,
    availableBtc?: Decimal
  ): SeedOrderPlan[] {
    const seedOrders: SeedOrderPlan[] = [];
    const currentPriceDec = new Decimal(currentMarketPrice);
    const investmentDec = new Decimal(this.config.investment);
    const MIN_NOTIONAL_USD = new Decimal(5.50);

    const isDualLayer = this.config.enableDualLayer !== false;
    const microRatio = isDualLayer ? new Decimal(this.config.microCapitalRatio || 0.25) : new Decimal(0);
    const macroRatio = new Decimal(1).minus(microRatio);

    const buyCapWeight = new Decimal(this.config.buyCapitalWeight || 0.52);
    const sellCapWeight = new Decimal(1).minus(buyCapWeight);

    // Presupuestos separados para Macro y Micro
    const macroInvest = investmentDec.times(macroRatio);
    const microInvest = investmentDec.times(microRatio);

    let macroUsdt = availableUsdt ? availableUsdt.times(macroRatio).times(0.98) : macroInvest.times(buyCapWeight);
    let microUsdt = availableUsdt ? availableUsdt.times(microRatio).times(0.98) : microInvest.times(buyCapWeight);

    let macroBtc = availableBtc
      ? availableBtc.times(macroRatio).times(0.98)
      : macroInvest.times(sellCapWeight).dividedBy(currentPriceDec);
    let microBtc = availableBtc
      ? availableBtc.times(microRatio).times(0.98)
      : microInvest.times(sellCapWeight).dividedBy(currentPriceDec);

    // 1. CAPA MACRO
    const macroBuyBudgetPerLevel = macroInvest.dividedBy(this.config.gridLevels - 1);
    const buyLevels = this.levels.filter((l) => new Decimal(l.price).lessThan(currentPriceDec));
    const sellLevels = this.levels.filter((l) => new Decimal(l.price).greaterThan(currentPriceDec));

    if (buyLevels.length > 0 && macroUsdt.greaterThanOrEqualTo(MIN_NOTIONAL_USD)) {
      const sortedBuyLevels = [...buyLevels].sort((a, b) =>
        new Decimal(b.price).minus(new Decimal(a.price)).toNumber()
      );

      for (let idx = 0; idx < sortedBuyLevels.length; idx++) {
        const level = sortedBuyLevels[idx];
        const weightFactor = Decimal.max(0.75, new Decimal(1.35).minus(new Decimal(idx).times(0.08)));
        const targetOrderUsd = macroBuyBudgetPerLevel.times(weightFactor);

        if (macroUsdt.greaterThanOrEqualTo(MIN_NOTIONAL_USD)) {
          const orderCost = Decimal.min(targetOrderUsd, macroUsdt);
          const levelPriceDec = new Decimal(level.price);
          const amount = orderCost.dividedBy(levelPriceDec).toDecimalPlaces(6, Decimal.ROUND_DOWN);

          if (amount.greaterThan(0.00001)) {
            macroUsdt = macroUsdt.minus(orderCost);
            seedOrders.push({
              levelIndex: level.levelIndex,
              price: levelPriceDec,
              side: 'buy',
              amount,
              layer: 'macro',
            });
          }
        }
      }
    }

    let minAllowedSellPrice = new Decimal(0);
    if (holdingCostBasis.length > 0) {
      const highestCost = Decimal.max(...holdingCostBasis);
      minAllowedSellPrice = highestCost.times(new Decimal(1.0015));
    }

    const sellIndexMap = new Map<number, number>();
    sellLevels.forEach((l, idx) => sellIndexMap.set(l.levelIndex, idx));

    for (const level of sellLevels) {
      const levelPriceDec = new Decimal(level.price);
      let finalSellPrice = levelPriceDec;
      const sellIdx = sellIndexMap.get(level.levelIndex) ?? 0;
      const staggeredMinPrice = minAllowedSellPrice.plus(this.stepSize.times(sellIdx));

      if (holdingCostBasis.length > 0 && finalSellPrice.lessThan(staggeredMinPrice)) {
        finalSellPrice = staggeredMinPrice;
      }

      if (macroBtc.greaterThan(0.00001)) {
        const targetBtc = macroBuyBudgetPerLevel.dividedBy(finalSellPrice);
        const actualBtc = Decimal.min(targetBtc, macroBtc).toDecimalPlaces(6, Decimal.ROUND_DOWN);
        if (actualBtc.greaterThan(0.00001)) {
          macroBtc = macroBtc.minus(actualBtc);
          seedOrders.push({
            levelIndex: level.levelIndex,
            price: finalSellPrice,
            side: 'sell',
            amount: actualBtc,
            layer: 'macro',
          });
        }
      }
    }

    // 2. CAPA MICRO (Micro-Grid para rotación continua)
    if (isDualLayer && microRatio.greaterThan(0.05)) {
      const microRange = this.config.microGridRangeUsd || new Decimal(2241.00);
      const microLevels = this.config.microGridLevels || 6;
      const microStep = microRange.dividedBy(Math.max(2, microLevels - 1));
      const baseMicroOrderUsd = microInvest.dividedBy(Math.max(2, microLevels - 1));

      const microLower = currentPriceDec.minus(microRange.dividedBy(2));

      for (let j = 0; j < microLevels; j++) {
        const mPrice = microLower.plus(microStep.times(j));
        if (mPrice.lessThan(currentPriceDec.times(0.9995))) {
          if (microUsdt.greaterThanOrEqualTo(MIN_NOTIONAL_USD)) {
            const cost = Decimal.min(baseMicroOrderUsd, microUsdt);
            const amt = cost.dividedBy(mPrice).toDecimalPlaces(6, Decimal.ROUND_DOWN);
            if (amt.greaterThan(0.00001)) {
              microUsdt = microUsdt.minus(cost);
              seedOrders.push({ levelIndex: j, price: mPrice, side: 'buy', amount: amt, layer: 'micro' });
            }
          }
        } else if (mPrice.greaterThan(currentPriceDec.times(1.0005))) {
          const amt = baseMicroOrderUsd.dividedBy(mPrice).toDecimalPlaces(6, Decimal.ROUND_DOWN);
          if (microBtc.greaterThanOrEqualTo(amt)) {
            microBtc = microBtc.minus(amt);
            seedOrders.push({ levelIndex: j, price: mPrice, side: 'sell', amount: amt, layer: 'micro' });
          }
        }
      }
    }

    return seedOrders;
  }

  public handleOrderFill(event: OrderExecutionEvent, layer: 'micro' | 'macro' = 'macro'): SeedOrderPlan | null {
    if (event.gridLevel === undefined || event.gridLevel < 0 || event.gridLevel >= this.levels.length) {
      console.warn(`[GridManager] Fill ignorado: Nivel de grilla no válido (${event.gridLevel})`);
      return null;
    }

    const fillAmountDec = new Decimal(event.amount);
    const eventPriceDec = new Decimal(event.price);
    const tpMult = new Decimal(layer === 'micro' ? 1.0 : (this.config.takeProfitMultiplier || 1.8));

    if (event.side === 'buy') {
      const targetPrice = eventPriceDec.plus(this.stepSize.times(tpMult));
      const flipPlan: SeedOrderPlan = {
        levelIndex: event.gridLevel + 1,
        price: targetPrice,
        side: 'sell',
        amount: fillAmountDec,
        layer,
      };
      this.emit('grid:flip_required', flipPlan);
      return flipPlan;
    } else if (event.side === 'sell') {
      const targetPrice = eventPriceDec.minus(this.stepSize.times(tpMult));
      const flipPlan: SeedOrderPlan = {
        levelIndex: event.gridLevel - 1,
        price: targetPrice,
        side: 'buy',
        amount: fillAmountDec,
        layer,
      };
      this.emit('grid:flip_required', flipPlan);
      return flipPlan;
    }

    return null;
  }
}
