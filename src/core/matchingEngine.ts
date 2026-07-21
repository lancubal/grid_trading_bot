import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { OrderSide, OrderStatus } from '@prisma/client';
import { StateRepository } from '../db/repository';
import { OrderExecutionEvent } from '../types';

export class LocalMatchingEngine {
  private repository: StateRepository;
  private eventEmitter: EventEmitter;
  private makerFeeRate: Decimal = new Decimal(0.0005); // 0.05% Maker Fee

  constructor(repository: StateRepository, eventEmitter: EventEmitter) {
    this.repository = repository;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Se ejecuta cada vez que el WebSocket / Ticker de Binance empuja un nuevo precio en vivo
   * @param currentPrice Precio actual del ticker en vivo (Decimal o number)
   */
  public async processLivePrice(currentPrice: Decimal | number): Promise<void> {
    const priceDec = new Decimal(currentPrice);

    // 1. Consultar todas las órdenes virtuales en estado OPEN en la base de datos
    const openOrders = await this.repository.getOpenOrders();

    for (const order of openOrders) {
      const orderPrice = new Decimal(order.price);
      const orderAmount = new Decimal(order.amount);

      let isFilled = false;

      // 2. Verificar condición de ejecución para COMPRA (Precio de mercado <= Precio de la orden)
      if (order.side === OrderSide.BUY && priceDec.lessThanOrEqualTo(orderPrice)) {
        isFilled = true;
      }
      // 3. Verificar condición de ejecución para VENTA (Precio de mercado >= Precio de la orden)
      else if (order.side === OrderSide.SELL && priceDec.greaterThanOrEqualTo(orderPrice)) {
        isFilled = true;
      }

      if (isFilled) {
        await this.executeVirtualOrder(order, orderPrice, orderAmount);
      }
    }
  }

  /**
   * Ejecuta la orden virtual en PostgreSQL y notifica al Grid Engine para colocar el Flip
   */
  private async executeVirtualOrder(
    dbOrder: any,
    executedPrice: Decimal,
    amount: Decimal
  ): Promise<OrderExecutionEvent> {
    const totalValueUsd = executedPrice.times(amount);
    const simulatedFeeUsd = totalValueUsd.times(this.makerFeeRate);

    // Actualizar estado en Prisma como FILLED con la comisión Maker
    await this.repository.updateOrderStatusById(dbOrder.id, OrderStatus.FILLED, simulatedFeeUsd);

    console.log(
      `[Matching Engine] ⚡ FILL SIMULADO EN BD: ID ${dbOrder.id} (${dbOrder.exchangeId || 'Virtual'}) | ${dbOrder.side} ${amount} @ $${executedPrice.toFixed(2)} USD (Comisión Maker: $${simulatedFeeUsd.toFixed(4)} USD)`
    );

    const eventPayload: OrderExecutionEvent = {
      id: dbOrder.exchangeId || dbOrder.id,
      clientOrderId: dbOrder.id,
      symbol: dbOrder.symbol,
      side: dbOrder.side === OrderSide.BUY ? 'buy' : 'sell',
      type: 'limit',
      price: executedPrice,
      amount,
      filled: amount,
      remaining: new Decimal(0),
      status: 'closed',
      timestamp: Date.now(),
      gridLevel: dbOrder.gridLevelId,
    };

    // Emitir eventos ORDER_FILLED y order:filled para activar el Flip en la grilla
    this.eventEmitter.emit('ORDER_FILLED', eventPayload);
    this.eventEmitter.emit('order:filled', eventPayload);

    return eventPayload;
  }
}
