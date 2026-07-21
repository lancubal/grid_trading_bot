import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import {
  IExchangeAdapter,
  ExchangeConfig,
  TickerData,
  OrderRequest,
  OrderResult,
  AccountBalance,
  CcxtExchangeAdapter,
} from './adapter';

export class ShadowExchangeAdapter extends EventEmitter implements IExchangeAdapter {
  private ccxtAdapter: CcxtExchangeAdapter;
  private openOrders: Map<string, OrderResult> = new Map();
  private balance: AccountBalance = {
    free: { USDT: new Decimal(1000), BTC: new Decimal(0) },
    used: { USDT: new Decimal(0), BTC: new Decimal(0) },
    total: { USDT: new Decimal(1000), BTC: new Decimal(0) },
  };

  constructor(config: ExchangeConfig) {
    super();
    this.ccxtAdapter = new CcxtExchangeAdapter(config);
  }

  public async initialize(): Promise<void> {
    console.log('----------------------------------------------------');
    console.log('🕵️ MODOS DE EJECUCIÓN: SHADOW TRADING (DRY RUN) ACTIVADO');
    console.log('   └─ Conectado al Mercado Real (Binance Spot Ticker)');
    console.log('   └─ Desvío de ejecuciones a simulador local en memoria/BD');
    console.log('----------------------------------------------------');
    await this.ccxtAdapter.initialize();
  }

  public async fetchTicker(symbol: string): Promise<TickerData> {
    const ticker = await this.ccxtAdapter.fetchTicker(symbol);
    // Evaluar simulación de ejecuciones con el precio de mercado actual
    this.processPriceTick(ticker.last, symbol);
    return ticker;
  }

  public async fetchBalance(): Promise<AccountBalance> {
    return this.balance;
  }

  public async createOrder(order: OrderRequest): Promise<OrderResult> {
    const orderId = `shadow-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const simulatedOrder: OrderResult = {
      id: orderId,
      symbol: order.symbol,
      type: order.type,
      side: order.side,
      price: order.price ?? new Decimal(0),
      amount: order.amount,
      filled: new Decimal(0),
      remaining: order.amount,
      status: 'open',
      timestamp: Date.now(),
    };

    this.openOrders.set(orderId, simulatedOrder);
    console.log(`[Shadow Trading] 📥 Orden Límite Creada: ID ${orderId} | ${order.side.toUpperCase()} ${order.amount} @ $${order.price?.toFixed(2)}`);

    return simulatedOrder;
  }

  public async cancelOrder(orderId: string, _symbol: string): Promise<boolean> {
    const order = this.openOrders.get(orderId);
    if (order) {
      order.status = 'canceled';
      this.openOrders.delete(orderId);
      console.log(`[Shadow Trading] 🚫 Orden Cancelada: ID ${orderId}`);
      return true;
    }
    return false;
  }

  public async fetchOrder(orderId: string, _symbol: string): Promise<OrderResult> {
    const order = this.openOrders.get(orderId);
    if (order) return order;

    return {
      id: orderId,
      symbol: 'BTC/USDT',
      type: 'limit',
      side: 'buy',
      price: new Decimal(0),
      amount: new Decimal(0),
      filled: new Decimal(0),
      remaining: new Decimal(0),
      status: 'canceled',
      timestamp: Date.now(),
    };
  }

  public async fetchOpenOrders(_symbol?: string): Promise<OrderResult[]> {
    return Array.from(this.openOrders.values()).filter((o) => o.status === 'open');
  }

  /**
   * Procesa cada tick de precio en vivo de Binance y dispara ejecuciones simuladas de órdenes límite
   */
  public processPriceTick(marketPrice: Decimal, _symbol: string): void {
    for (const [id, order] of this.openOrders.entries()) {
      if (order.status !== 'open') continue;

      let isFilled = false;

      // 1. BUY LIMIT: Se ejecuta si el precio de mercado cae o toca el precio de la orden
      if (order.side === 'buy' && marketPrice.lessThanOrEqualTo(order.price)) {
        isFilled = true;
      }
      // 2. SELL LIMIT: Se ejecuta si el precio de mercado sube o toca el precio de la orden
      else if (order.side === 'sell' && marketPrice.greaterThanOrEqualTo(order.price)) {
        isFilled = true;
      }

      if (isFilled) {
        order.status = 'closed';
        order.filled = order.amount;
        order.remaining = new Decimal(0);
        this.openOrders.delete(id);

        console.log(`[Shadow Trading] ⚡ FILL SIMULADO EN VIVO: Orden ${id} | ${order.side.toUpperCase()} ${order.amount} @ $${order.price.toFixed(2)} (Precio Mercado: $${marketPrice.toFixed(2)})`);

        this.emit('order:filled', {
          id: order.id,
          clientOrderId: order.id,
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          price: order.price,
          amount: order.amount,
          filled: order.filled,
          remaining: order.remaining,
          status: 'closed',
          timestamp: Date.now(),
        });
      }
    }
  }
}
