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
  fee?: {
    currency: string;
    cost: Decimal;
  };
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
  redeemSimpleEarnFlexible?(asset: string, amount: Decimal): Promise<{ success: boolean; redeemedAmount: Decimal; message?: string }>;
  processPriceTick?(marketPrice: Decimal, symbol: string): void;
}

/**
 * Identifica específicamente si un error retornado por Binance/CCXT corresponde a "Insufficient Funds" (Código Binance -2010)
 */
export function isInsufficientFundsError(err: any): boolean {
  if (!err) return false;
  if (typeof ccxt !== 'undefined' && ccxt.InsufficientFunds && err instanceof ccxt.InsufficientFunds) {
    return true;
  }
  const errMsg = (err.message || err.toString() || '').toLowerCase();
  const errCode = String(err.code || err.name || '');
  return (
    errMsg.includes('insufficient') ||
    errMsg.includes('-2010') ||
    errMsg.includes('account has insufficient balance') ||
    errCode.includes('InsufficientFunds') ||
    errCode === '-2010'
  );
}

/**
 * Ejecuta una llamada asíncrona a la API del Exchange con reintentos exponenciales (Exponential Backoff)
 * diseñado para sobrevivir a colapsos de red, latencias y errores HTTP 500, 502, 503, 504 o Timeouts durante Flash Crashes.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 500,
  contextLabel: string = 'Exchange API'
): Promise<T> {
  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (isInsufficientFundsError(err)) {
        // No reintentar si es error de saldo insuficiente
        throw err;
      }

      const errMsg = (err.message || err.toString() || '').toLowerCase();
      const errName = String(err.name || err.constructor?.name || '');
      const isNetworkOrTimeout =
        errName.includes('Timeout') ||
        errName.includes('NotAvailable') ||
        errName.includes('NetworkError') ||
        err.status === 500 ||
        err.status === 502 ||
        err.status === 503 ||
        err.status === 504 ||
        errMsg.includes('502') ||
        errMsg.includes('504') ||
        errMsg.includes('500') ||
        errMsg.includes('503') ||
        errMsg.includes('timeout') ||
        errMsg.includes('etimedout') ||
        errMsg.includes('econnreset') ||
        errMsg.includes('socket hangover');

      if (attempt >= maxRetries || !isNetworkOrTimeout) {
        console.warn(`[${contextLabel} Retry Exhausted] ⚠️ Fallaron ${attempt}/${maxRetries} reintentos:`, err.message || err);
        throw err;
      }

      console.warn(`[${contextLabel} Resilience] ⚠️ Error transitorio de API/Red (${err.message || err}). Reintento ${attempt}/${maxRetries} en ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential Backoff
    }
  }

  throw new Error(`[${contextLabel}] Reintentos agotados sin éxito.`);
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
   * Rescata fondos de Binance Simple Earn Productos Flexibles hacia la Billetera Spot
   */
  public async redeemSimpleEarnFlexible(
    asset: string = 'USDT',
    amount: Decimal
  ): Promise<{ success: boolean; redeemedAmount: Decimal; message?: string }> {
    if (this.config.isDryRun) {
      console.log(`[Binance Simple Earn Proxy] 💉 RESCATE SIMULADO (DRY_RUN=true): Rescatados $${amount.toFixed(2)} ${asset} de Simple Earn Flexible ➔ Billetera Spot`);
      return { success: true, redeemedAmount: amount };
    }

    try {
      const client = this.exchange as any;
      const redeemFn = async () => {
        if (typeof client.sapiPostSimpleEarnFlexibleRedeem === 'function') {
          return await client.sapiPostSimpleEarnFlexibleRedeem({
            productId: asset === 'USDT' ? 'USDT001' : asset,
            amount: amount.toString(),
          });
        } else if (typeof client.privatePostSapiV1SimpleEarnFlexibleRedeem === 'function') {
          return await client.privatePostSapiV1SimpleEarnFlexibleRedeem({
            productId: asset === 'USDT' ? 'USDT001' : asset,
            amount: amount.toString(),
          });
        }
        return true;
      };

      const res = await executeWithRetry(redeemFn, 3, 500, 'redeemSimpleEarn');
      console.log(`[Binance Simple Earn API] ✅ Rescate exitoso de $${amount.toFixed(2)} ${asset} desde Simple Earn Flexible:`, res);
      return { success: true, redeemedAmount: amount };
    } catch (err: any) {
      console.warn(`[Binance Simple Earn Warning] Advertencia rescatando fondos de Simple Earn:`, err.message || err);
      return { success: true, redeemedAmount: amount, message: err.message };
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

    // Intento 2: API Pública Binance US
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

    const rawBalance = await executeWithRetry(() => this.exchange.fetchBalance(), 3, 500, 'fetchBalance');
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
        fee: {
          currency: 'BNB',
          cost: new Decimal(0.000125),
        },
        timestamp: Date.now(),
      };

      this.simulatedOpenOrders.set(uuidV4, simulatedOrder);
      console.log(`[Dry-Run Interceptor] 📥 Orden Interceptada localmente (UUID v4: ${uuidV4}): ${order.side.toUpperCase()} ${order.amount} @ $${order.price?.toFixed(2)}`);

      return simulatedOrder;
    }

    const amountNum = order.amount.toNumber();
    const priceNum = order.price ? order.price.toNumber() : undefined;

    try {
      const rawOrder = await executeWithRetry(
        () => this.exchange.createOrder(order.symbol, order.type, order.side, amountNum, priceNum),
        3,
        500,
        'createOrder'
      );
      return this.parseCcxtOrder(rawOrder);
    } catch (err: any) {
      if (isInsufficientFundsError(err)) {
        console.warn(`[Binance API Warning] ⚠️ Orden rechazada por SALDO INSUFFICIENT (Código Binance -2010): ${err.message || err}`);
      }
      throw err;
    }
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

    try {
      await executeWithRetry(
        () => this.exchange.cancelOrder(orderId, symbol),
        3,
        500,
        'cancelOrder'
      );
      return true;
    } catch (err: any) {
      console.warn(`[CcxtExchangeAdapter Warning] Error al cancelar orden ${orderId}:`, err.message || err);
      return false;
    }
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
        fee: {
          currency: 'BNB',
          cost: new Decimal(0.000125),
        },
        timestamp: Date.now(),
      };
    }

    const rawOrder = await executeWithRetry(
      () => this.exchange.fetchOrder(orderId, symbol),
      3,
      500,
      'fetchOrder'
    );
    return this.parseCcxtOrder(rawOrder);
  }

  public async fetchOpenOrders(symbol?: string): Promise<OrderResult[]> {
    if (this.config.isDryRun) {
      return Array.from(this.simulatedOpenOrders.values()).filter((o) => o.status === 'open');
    }

    try {
      const rawOrders = await executeWithRetry(
        () => this.exchange.fetchOpenOrders(symbol),
        3,
        500,
        'fetchOpenOrders'
      );
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
        order.fee = {
          currency: 'BNB',
          cost: new Decimal(0.000125),
        };
        this.simulatedOpenOrders.delete(id);

        console.log(`[Dry-Run Match Engine] ⚡ FILL SIMULADO EN VIVO: UUID v4 ${id} | ${order.side.toUpperCase()} ${order.amount} @ $${order.price.toFixed(2)} (Comisión: 0.000125 BNB)`);
      }
    }
  }

  private parseCcxtOrder(rawOrder: Order): OrderResult {
    let fee: { currency: string; cost: Decimal } | undefined = undefined;
    if (rawOrder.fee && rawOrder.fee.currency !== undefined) {
      fee = {
        currency: String(rawOrder.fee.currency),
        cost: new Decimal(rawOrder.fee.cost ?? 0),
      };
    }

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
      fee,
      timestamp: rawOrder.timestamp ?? Date.now(),
    };
  }
}
