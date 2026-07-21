import crypto from 'node:crypto';
import ccxt, { Exchange, Order } from 'ccxt';
import Decimal from 'decimal.js';

export interface ExchangeConfig {
  exchangeId: string;
  apiKey?: string;
  secret?: string;
  isTestnet?: boolean;
  isDryRun?: boolean;
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

export interface IExchangeAdapter {
  initialize(): Promise<void>;
  fetchTicker(symbol: string): Promise<TickerData>;
  fetchBalance(): Promise<AccountBalance>;
  createOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  fetchOrder(orderId: string, symbol: string): Promise<OrderResult>;
  fetchOpenOrders(symbol?: string): Promise<OrderResult[]>;
  processPriceTick?(marketPrice: Decimal, symbol: string): void;
}

/**
 * Adaptador de Exchange con Interceptor Condicional de Órdenes y Resiliencia Geográfica (AWS / Cloud).
 */
export class CcxtExchangeAdapter implements IExchangeAdapter {
  private exchange!: Exchange;
  private readonly config: ExchangeConfig;
  private simulatedOpenOrders: Map<string, OrderResult> = new Map();
  private lastKnownPrice: Decimal = new Decimal(64500);

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

    if (this.config.isDryRun) {
      console.log(`[ExchangeAdapter Proxy] 🕵️ INTERCEPTOR ACTIVADO (DRY_RUN=true): Escrituras desviadas a simulador local UUID v4.`);
    }

    if (this.config.isTestnet) {
      try {
        this.exchange.setSandboxMode(true);
        console.log(`[ExchangeAdapter] ${this.config.exchangeId.toUpperCase()} configurado en modo TESTNET (Sandbox).`);
      } catch (err) {
        console.warn('[ExchangeAdapter] Advertencia al activar Sandbox mode:', err);
      }
    }

    try {
      await this.exchange.loadMarkets();
      console.log(`[ExchangeAdapter] Mercados cargados exitosamente para ${this.config.exchangeId.toUpperCase()}`);
    } catch (err) {
      console.warn(`[ExchangeAdapter Geo Alert] Lectura directa de mercados CCXT bloqueada en AWS US IP. Usando fallback de precio público (Binance US / Kraken):`, err);
    }
  }

  /**
   * Lectura de ticker con resiliencia multi-fuente ante bloqueos de IP geográficos en AWS
   */
  public async fetchTicker(symbol: string): Promise<TickerData> {
    let lastPrice = this.lastKnownPrice;
    let success = false;

    // Intento 1: CCXT Exchange
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      if (ticker && ticker.last) {
        lastPrice = new Decimal(ticker.last);
        this.lastKnownPrice = lastPrice;
        success = true;
      }
    } catch (err: any) {
      // Ignorar 451 y pasar a fallback
    }

    // Intento 2: API Pública Binance US (Acceso permitido en todo AWS US)
    if (!success) {
      try {
        const cleanSymbol = symbol.replace('/', '');
        const res = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${cleanSymbol}`);
        const json = await res.json();
        if (json && json.price) {
          lastPrice = new Decimal(json.price);
          this.lastKnownPrice = lastPrice;
          success = true;
        }
      } catch (err) {
        // Pasar a intento 3
      }
    }

    // Intento 3: API Pública Binance Global
    if (!success) {
      try {
        const cleanSymbol = symbol.replace('/', '');
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
        const json = await res.json();
        if (json && json.price) {
          lastPrice = new Decimal(json.price);
          this.lastKnownPrice = lastPrice;
          success = true;
        }
      } catch (err) {
        // Fallback a lastKnownPrice
      }
    }

    if (this.config.isDryRun) {
      this.processPriceTick(lastPrice, symbol);
    }

    return {
      symbol,
      bid: lastPrice,
      ask: lastPrice,
      last: lastPrice,
      timestamp: Date.now(),
    };
  }

  public async fetchBalance(): Promise<AccountBalance> {
    if (this.config.isDryRun) {
      return {
        free: { USDT: new Decimal(1000), BTC: new Decimal(0) },
        used: { USDT: new Decimal(0), BTC: new Decimal(0) },
        total: { USDT: new Decimal(1000), BTC: new Decimal(0) },
      };
    }

    const rawBalance = await this.exchange.fetchBalance();
    const free: Record<string, Decimal> = {};
    const used: Record<string, Decimal> = {};
    const total: Record<string, Decimal> = {};

    if (rawBalance.free) {
      for (const [coin, val] of Object.entries(rawBalance.free)) {
        if (val !== undefined && val !== null) free[coin] = new Decimal(val as number);
      }
    }
    if (rawBalance.used) {
      for (const [coin, val] of Object.entries(rawBalance.used)) {
        if (val !== undefined && val !== null) used[coin] = new Decimal(val as number);
      }
    }
    if (rawBalance.total) {
      for (const [coin, val] of Object.entries(rawBalance.total)) {
        if (val !== undefined && val !== null) total[coin] = new Decimal(val as number);
      }
    }

    return { free, used, total };
  }

  /**
   * Interceptor de Creación de Órdenes: Genera UUID v4 en modo Dry-Run
   */
  public async createOrder(order: OrderRequest): Promise<OrderResult> {
    if (this.config.isDryRun) {
      const uuidV4 = crypto.randomUUID();
      const simulatedOrder: OrderResult = {
        id: uuidV4,
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

      this.simulatedOpenOrders.set(uuidV4, simulatedOrder);
      console.log(`[Dry-Run Interceptor] 📥 Orden Interceptada localmente (UUID v4: ${uuidV4}): ${order.side.toUpperCase()} ${order.amount} @ $${order.price?.toFixed(2)}`);

      return simulatedOrder;
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
    if (this.config.isDryRun) {
      const order = this.simulatedOpenOrders.get(orderId);
      if (order) {
        order.status = 'canceled';
        this.simulatedOpenOrders.delete(orderId);
        console.log(`[Dry-Run Interceptor] 🚫 Orden Cancelada (UUID v4: ${orderId})`);
        return true;
      }
      return false;
    }

    await this.exchange.cancelOrder(orderId, symbol);
    return true;
  }

  public async fetchOrder(orderId: string, symbol: string): Promise<OrderResult> {
    if (this.config.isDryRun) {
      const order = this.simulatedOpenOrders.get(orderId);
      if (order) return order;
      return {
        id: orderId,
        symbol,
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

    const rawOrder = await this.exchange.fetchOrder(orderId, symbol);
    return this.parseCcxtOrder(rawOrder);
  }

  public async fetchOpenOrders(symbol?: string): Promise<OrderResult[]> {
    if (this.config.isDryRun) {
      return Array.from(this.simulatedOpenOrders.values()).filter((o) => o.status === 'open');
    }

    try {
      const rawOrders = await this.exchange.fetchOpenOrders(symbol);
      return rawOrders.map((raw) => this.parseCcxtOrder(raw));
    } catch (err) {
      console.warn('[ExchangeAdapter] Advertencia al consultar órdenes abiertas:', err);
      return [];
    }
  }

  public processPriceTick(marketPrice: Decimal, _symbol: string): void {
    for (const [id, order] of this.simulatedOpenOrders.entries()) {
      if (order.status !== 'open') continue;

      let isFilled = false;
      if (order.side === 'buy' && marketPrice.lessThanOrEqualTo(order.price)) {
        isFilled = true;
      } else if (order.side === 'sell' && marketPrice.greaterThanOrEqualTo(order.price)) {
        isFilled = true;
      }

      if (isFilled) {
        order.status = 'closed';
        order.filled = order.amount;
        order.remaining = new Decimal(0);
        this.simulatedOpenOrders.delete(id);

        console.log(`[Dry-Run Match Engine] ⚡ FILL SIMULADO EN VIVO: UUID v4 ${id} | ${order.side.toUpperCase()} ${order.amount} @ $${order.price.toFixed(2)} (Precio Mercado: $${marketPrice.toFixed(2)})`);
      }
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
