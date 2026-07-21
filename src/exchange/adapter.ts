import ccxt, { Exchange, Order } from 'ccxt';
import Decimal from 'decimal.js';

export interface ExchangeConfig {
  exchangeId: string;
  apiKey?: string;
  secret?: string;
  isTestnet?: boolean;
  options?: Record<string, unknown>;
}

export interface TickerData {
  symbol: string;
  bid: Decimal;
  ask: Decimal;
  last: Decimal;
  high?: Decimal;
  low?: Decimal;
  timestamp: number;
}

export interface OrderRequest {
  symbol: string;
  type: 'limit' | 'market';
  side: 'buy' | 'sell';
  amount: Decimal;
  price?: Decimal;
}

export interface OrderResult {
  id: string;
  symbol: string;
  type: string;
  side: 'buy' | 'sell';
  price: Decimal;
  amount: Decimal;
  filled: Decimal;
  remaining: Decimal;
  status: 'open' | 'closed' | 'canceled' | 'expired' | 'rejected';
  timestamp: number;
}

export interface AccountBalance {
  free: Record<string, Decimal>;
  used: Record<string, Decimal>;
  total: Record<string, Decimal>;
}

/**
 * Interface desacoplada para interacción con el exchange.
 * El motor de estrategia dependerá de esta interfaz y no de CCXT directamente.
 */
export interface IExchangeAdapter {
  initialize(): Promise<void>;
  fetchTicker(symbol: string): Promise<TickerData>;
  fetchBalance(): Promise<AccountBalance>;
  createOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  fetchOrder(orderId: string, symbol: string): Promise<OrderResult>;
  fetchOpenOrders(symbol?: string): Promise<OrderResult[]>;
}

/**
 * Adaptador basado en la librería CCXT con soporte para Testnet/Sandbox.
 */
export class CcxtExchangeAdapter implements IExchangeAdapter {
  private exchange!: Exchange;
  private readonly config: ExchangeConfig;

  constructor(config: ExchangeConfig) {
    this.config = config;
  }

  public async initialize(): Promise<void> {
    const exchangeClass = ccxt[this.config.exchangeId as keyof typeof ccxt] as typeof Exchange;

    if (!exchangeClass) {
      throw new Error(`Exchange desconocido o no soportado por CCXT: ${this.config.exchangeId}`);
    }

    this.exchange = new exchangeClass({
      apiKey: this.config.apiKey || '',
      secret: this.config.secret || '',
      enableRateLimit: true,
      options: this.config.options || {},
    });

    if (this.config.isTestnet) {
      this.exchange.setSandboxMode(true);
      console.log(`[ExchangeAdapter] ${this.config.exchangeId.toUpperCase()} configurado en modo TESTNET (Sandbox).`);
    }

    await this.exchange.loadMarkets();
    console.log(`[ExchangeAdapter] Mercados cargados exitosamente para ${this.config.exchangeId.toUpperCase()}`);
  }

  public async fetchTicker(symbol: string): Promise<TickerData> {
    const ticker = await this.exchange.fetchTicker(symbol);

    return {
      symbol: ticker.symbol ?? symbol,
      bid: new Decimal(ticker.bid ?? 0),
      ask: new Decimal(ticker.ask ?? 0),
      last: new Decimal(ticker.last ?? 0),
      high: ticker.high !== undefined && ticker.high !== null ? new Decimal(ticker.high) : undefined,
      low: ticker.low !== undefined && ticker.low !== null ? new Decimal(ticker.low) : undefined,
      timestamp: ticker.timestamp ?? Date.now(),
    };
  }

  public async fetchBalance(): Promise<AccountBalance> {
    const rawBalance = await this.exchange.fetchBalance();
    const free: Record<string, Decimal> = {};
    const used: Record<string, Decimal> = {};
    const total: Record<string, Decimal> = {};

    if (rawBalance.free) {
      for (const [coin, val] of Object.entries(rawBalance.free)) {
        if (val !== undefined && val !== null) {
          free[coin] = new Decimal(val as number);
        }
      }
    }

    if (rawBalance.used) {
      for (const [coin, val] of Object.entries(rawBalance.used)) {
        if (val !== undefined && val !== null) {
          used[coin] = new Decimal(val as number);
        }
      }
    }

    if (rawBalance.total) {
      for (const [coin, val] of Object.entries(rawBalance.total)) {
        if (val !== undefined && val !== null) {
          total[coin] = new Decimal(val as number);
        }
      }
    }

    return { free, used, total };
  }

  public async createOrder(order: OrderRequest): Promise<OrderResult> {
    if (!this.config.apiKey) {
      console.log(`[ExchangeAdapter] Mock Order colocada en ${order.symbol}: ${order.side.toUpperCase()} ${order.amount} @ $${order.price}`);
      return {
        id: `mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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
    }

    const amountNum = order.amount.toNumber();
    const priceNum = order.price ? order.price.toNumber() : undefined;

    const rawOrder = await this.exchange.createOrder(
      order.symbol,
      order.type,
      order.side,
      amountNum,
      priceNum
    );

    return this.parseCcxtOrder(rawOrder);
  }

  public async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    if (!this.config.apiKey) return true;
    await this.exchange.cancelOrder(orderId, symbol);
    return true;
  }

  public async fetchOrder(orderId: string, symbol: string): Promise<OrderResult> {
    if (!this.config.apiKey) {
      return {
        id: orderId,
        symbol,
        type: 'limit',
        side: 'buy',
        price: new Decimal(0),
        amount: new Decimal(0),
        filled: new Decimal(0),
        remaining: new Decimal(0),
        status: 'open',
        timestamp: Date.now(),
      };
    }
    const rawOrder = await this.exchange.fetchOrder(orderId, symbol);
    return this.parseCcxtOrder(rawOrder);
  }

  public async fetchOpenOrders(symbol?: string): Promise<OrderResult[]> {
    if (!this.config.apiKey) {
      console.log('[ExchangeAdapter] API Key no provista. Modo Mock/Offline para órdenes abiertas.');
      return [];
    }

    try {
      const rawOrders = await this.exchange.fetchOpenOrders(symbol);
      return rawOrders.map((raw) => this.parseCcxtOrder(raw));
    } catch (err) {
      console.warn('[ExchangeAdapter] Advertencia al consultar órdenes abiertas:', err);
      return [];
    }
  }

  private parseCcxtOrder(rawOrder: Order): OrderResult {
    return {
      id: rawOrder.id ?? '',
      symbol: rawOrder.symbol ?? '',
      type: rawOrder.type ?? 'limit',
      side: (rawOrder.side as 'buy' | 'sell') || 'buy',
      price: new Decimal(rawOrder.price ?? 0),
      amount: new Decimal(rawOrder.amount ?? 0),
      filled: new Decimal(rawOrder.filled ?? 0),
      remaining: new Decimal(rawOrder.remaining ?? 0),
      status: (rawOrder.status as OrderResult['status']) || 'open',
      timestamp: rawOrder.timestamp ?? Date.now(),
    };
  }
}
