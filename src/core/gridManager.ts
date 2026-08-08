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
}

export class GridManager extends EventEmitter {
  private config: GridConfigInput;
  private levels: GridLevel[] = [];
  private stepSize: Decimal;
  private makerFeeRate: Decimal = new Decimal(0.0005); // 0.05%

  constructor(config: GridConfigInput) {
    super();
    this.config = config;
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
   * Ajusta dinámicamente el ancho de la grilla y la separación entre niveles según el indicador ATR
   */
  public adjustToVolatility(
    atr: Decimal,
    currentMarketPrice: Decimal,
    multiplier: number = 4.0,
    minRange: number = 800,
    maxRange: number = 6000
  ): { newLowerPrice: Decimal; newUpperPrice: Decimal; dynamicRange: Decimal; stepSize: Decimal } {
    const dynamicRange = AtrCalculator.calculateDynamicRange(atr, multiplier, minRange, maxRange);
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

  /**
   * Genera las órdenes de siembra iniciales con adaptación dinámica al saldo disponible en Binance (USDT y BTC)
   * @param currentMarketPrice Precio actual de mercado
   * @param holdingCostBasis Array opcional con los precios de compra originales del inventario retenido
   * @param availableUsdt Saldo libre disponible en USDT (para limitar el presupuesto de compras)
   * @param availableBtc Saldo libre disponible en BTC (para limitar el presupuesto de ventas)
   */
  public generateSeedOrders(
    currentMarketPrice: Decimal | number | string,
    holdingCostBasis: Decimal[] = [],
    availableUsdt?: Decimal,
    availableBtc?: Decimal
  ): SeedOrderPlan[] {
    const seedOrders: SeedOrderPlan[] = [];
    const currentPriceDec = new Decimal(currentMarketPrice);
    const investmentDec = new Decimal(this.config.investment);

    const buyLevels = this.levels.filter((l) => new Decimal(l.price).lessThan(currentPriceDec));
    const sellLevels = this.levels.filter((l) => new Decimal(l.price).greaterThan(currentPriceDec));

    // Presupuesto base por nivel si estuviera 100% líquido en USDT
    const defaultBuyBudgetPerLevel = investmentDec.dividedBy(this.config.gridLevels - 1);
    const totalReqBuyUsdt = defaultBuyBudgetPerLevel.times(buyLevels.length);

    // Ajustar presupuesto de compras al saldo libre real en USDT (con margen del 2% para comisiones)
    const actualBuyBudgetPerLevel =
      availableUsdt && buyLevels.length > 0 && availableUsdt.lessThan(totalReqBuyUsdt)
        ? availableUsdt.times(0.98).dividedBy(buyLevels.length)
        : defaultBuyBudgetPerLevel;

    // Presupuesto base en BTC por nivel para ventas
    const defaultSellBtcPerLevel =
      sellLevels.length > 0
        ? defaultBuyBudgetPerLevel.dividedBy(currentPriceDec)
        : new Decimal(0);
    const totalReqSellBtc = defaultSellBtcPerLevel.times(sellLevels.length);

    // Ajustar presupuesto de ventas al saldo libre real en BTC (con margen del 2% para comisiones)
    const actualSellBtcPerLevel =
      availableBtc && sellLevels.length > 0 && availableBtc.lessThan(totalReqSellBtc)
        ? availableBtc.times(0.98).dividedBy(sellLevels.length)
        : null;

    // Calcular el precio mínimo de venta permitido para proteger el inventario
    let minAllowedSellPrice = new Decimal(0);
    if (holdingCostBasis.length > 0) {
      const highestCost = Decimal.max(...holdingCostBasis);
      minAllowedSellPrice = highestCost.times(new Decimal(1.0015));
    }

    const sellIndexMap = new Map<number, number>();
    sellLevels.forEach((l, idx) => sellIndexMap.set(l.levelIndex, idx));

    for (const level of this.levels) {
      const levelPriceDec = new Decimal(level.price);

      if (levelPriceDec.lessThan(currentPriceDec)) {
        const amount = actualBuyBudgetPerLevel.dividedBy(levelPriceDec);
        if (amount.greaterThan(0.00001)) {
          seedOrders.push({
            levelIndex: level.levelIndex,
            price: levelPriceDec,
            side: 'buy',
            amount: amount.toDecimalPlaces(6, Decimal.ROUND_DOWN),
          });
        }
      } else if (levelPriceDec.greaterThan(currentPriceDec)) {
        let finalSellPrice = levelPriceDec;
        const sellIdx = sellIndexMap.get(level.levelIndex) ?? 0;
        const staggeredMinPrice = minAllowedSellPrice.plus(this.stepSize.times(sellIdx));

        if (holdingCostBasis.length > 0 && finalSellPrice.lessThan(staggeredMinPrice)) {
          console.warn(
            `[Inventory Cost Guard] 🛡️ Orden de VENTA Nivel ${level.levelIndex} escalonada de $${finalSellPrice.toFixed(2)} a $${staggeredMinPrice.toFixed(2)} USD para evitar colapso de precios.`
          );
          finalSellPrice = staggeredMinPrice;
        }

        const amount = actualSellBtcPerLevel
          ? actualSellBtcPerLevel
          : defaultBuyBudgetPerLevel.dividedBy(finalSellPrice);

        if (amount.greaterThan(0.00001)) {
          seedOrders.push({
            levelIndex: level.levelIndex,
            price: finalSellPrice,
            side: 'sell',
            amount: amount.toDecimalPlaces(6, Decimal.ROUND_DOWN),
          });
        }
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
    const eventPriceDec = new Decimal(event.price);

    if (event.side === 'buy') {
      const targetLevelIndex = event.gridLevel + 1;
      if (targetLevelIndex < this.levels.length) {
        let targetPrice = new Decimal(this.levels[targetLevelIndex].price);

        const minProfitPrice = eventPriceDec.times(new Decimal(1.0015));
        if (targetPrice.lessThan(minProfitPrice)) {
          targetPrice = minProfitPrice;
        }

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
