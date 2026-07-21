import { EventEmitter } from 'events';
import ccxt, { Exchange } from 'ccxt';
import Decimal from 'decimal.js';
import { OrderExecutionEvent, OrderExecutionEventSchema } from '../types';
import { ExchangeConfig } from './adapter';

export interface IExchangeStreams extends EventEmitter {
  initialize?(): Promise<void>;
  subscribeOrders(symbol: string): Promise<void>;
  subscribeTicker(symbol: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Adaptador de Streams WebSockets basado en CCXT / WS nativo para capturar ejecuciones en tiempo real.
 * Soporta Binance Testnet (¡100% GRATIS!) y otros exchanges mediante la API unificada.
 */
export class CcxtExchangeStreams extends EventEmitter implements IExchangeStreams {
  private exchange!: Exchange;
  private readonly config: ExchangeConfig;
  private isListening: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(config: ExchangeConfig) {
    super();
    this.config = config;
  }

  public async initialize(): Promise<void> {
    const exchangeClass = ccxt[this.config.exchangeId as keyof typeof ccxt] as typeof Exchange;

    if (!exchangeClass) {
      throw new Error(`Exchange desconocido para streams: ${this.config.exchangeId}`);
    }

    this.exchange = new exchangeClass({
      apiKey: this.config.apiKey || '',
      secret: this.config.secret || '',
      enableRateLimit: true,
      options: this.config.options || {},
    });

    if (this.config.isTestnet) {
      this.exchange.setSandboxMode(true);
    }
  }

  public async subscribeOrders(symbol: string): Promise<void> {
    console.log(`[ExchangeStreams] 📡 Conectando WebSocket de órdenes para ${symbol} (${this.config.exchangeId.toUpperCase()})...`);
    this.isListening = true;
    this.listenOrderLoop(symbol);
  }

  public async subscribeTicker(symbol: string): Promise<void> {
    console.log(`[ExchangeStreams] 📡 Conectando WebSocket de ticker para ${symbol}...`);
    this.listenTickerLoop(symbol);
  }

  public async close(): Promise<void> {
    this.isListening = false;
    console.log('[ExchangeStreams] 🔌 Conexión WebSocket cerrada.');
  }

  /**
   * Bucle asíncrono para escuchar órdenes ejecutadas via WebSocket (CCXT Pro / WS)
   */
  private async listenOrderLoop(symbol: string): Promise<void> {
    while (this.isListening) {
      try {
        if (typeof (this.exchange as any).watchOrders === 'function') {
          const rawOrders = await (this.exchange as any).watchOrders(symbol);
          this.reconnectAttempts = 0; // Reset counter on success

          for (const rawOrder of rawOrders) {
            this.processRawOrder(rawOrder);
          }
        } else {
          // Fallback a polling optimizado de baja latencia si watchOrders no está disponible
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (!this.isListening) break;

          const openOrders = await this.exchange.fetchOpenOrders(symbol);
        }
      } catch (error) {
        if (!this.isListening) break;
        console.error('[ExchangeStreams Error] Error en stream de órdenes:', error);
        await this.handleReconnection(symbol);
      }
    }
  }

  /**
   * Bucle asíncrono para escuchar el ticker en tiempo real
   */
  private async listenTickerLoop(symbol: string): Promise<void> {
    while (this.isListening) {
      try {
        if (typeof (this.exchange as any).watchTicker === 'function') {
          const ticker = await (this.exchange as any).watchTicker(symbol);
          if (ticker && ticker.last) {
            this.emit('ticker:updated', {
              symbol: ticker.symbol ?? symbol,
              price: new Decimal(ticker.last),
              timestamp: ticker.timestamp ?? Date.now(),
            });
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (err) {
        if (!this.isListening) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Conversión segura a Decimal sin arrojar excepciones
   */
  private safeDecimal(val: any): Decimal | null {
    try {
      if (val === undefined || val === null) return new Decimal(0);
      return new Decimal(val);
    } catch {
      return null;
    }
  }

  /**
   * Parsea y valida el payload asíncrono recibido usando Zod
   */
  public processRawOrder(rawOrder: any): OrderExecutionEvent | null {
    try {
      const priceDec = this.safeDecimal(rawOrder.price);
      const amountDec = this.safeDecimal(rawOrder.amount);
      const filledDec = this.safeDecimal(rawOrder.filled);
      const remainingDec = this.safeDecimal(rawOrder.remaining);

      if (!priceDec || !amountDec || !filledDec || !remainingDec) {
        console.warn('[ExchangeStreams Zod Error] Valores numéricos o Decimal inválidos en payload:', rawOrder);
        return null;
      }

      const candidate = {
        id: String(rawOrder.id ?? ''),
        clientOrderId: rawOrder.clientOrderId ? String(rawOrder.clientOrderId) : undefined,
        symbol: String(rawOrder.symbol ?? ''),
        side: rawOrder.side === 'buy' ? 'buy' : 'sell',
        type: rawOrder.type === 'market' ? 'market' : 'limit',
        price: priceDec,
        amount: amountDec,
        filled: filledDec,
        remaining: remainingDec,
        status: (rawOrder.status as any) || 'open',
        timestamp: rawOrder.timestamp ?? Date.now(),
      };

      const parseResult = OrderExecutionEventSchema.safeParse(candidate);

      if (!parseResult.success) {
        console.warn('[ExchangeStreams Zod Error] Payload de orden rechazado por validación de Zod:', parseResult.error.format());
        return null;
      }

      const validatedEvent = parseResult.data;

      if (validatedEvent.status === 'closed' || validatedEvent.filled.greaterThan(0)) {
        this.emit('order:filled', validatedEvent);
      } else {
        this.emit('order:created', validatedEvent);
      }

      return validatedEvent;
    } catch (err) {
      console.warn('[ExchangeStreams Parse Error] Excepción al procesar orden:', err);
      return null;
    }
  }

  /**
   * Maneja el reintento de conexión con backoff exponencial
   */
  private async handleReconnection(symbol: string): Promise<void> {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('[ExchangeStreams Fatal] Se alcanzó el número máximo de reintentos de conexión WebSocket.');
      this.emit('error', new Error('Máximo de reintentos de WebSocket alcanzado'));
      this.isListening = false;
      return;
    }

    const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[ExchangeStreams] Reintentando conexión WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts}) en ${backoffMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}

/**
 * Adaptador de Streams simulado (Mock) para testing local y desarrollo sin credenciales.
 */
export class MockExchangeStreams extends EventEmitter implements IExchangeStreams {
  private isConnected: boolean = false;

  public async subscribeOrders(symbol: string): Promise<void> {
    this.isConnected = true;
    console.log(`[MockExchangeStreams] 🧪 Conectado en modo Mock para ${symbol}`);
  }

  public async subscribeTicker(symbol: string): Promise<void> {
    console.log(`[MockExchangeStreams] 🧪 Suscrito a ticker Mock para ${symbol}`);
  }

  public async close(): Promise<void> {
    this.isConnected = false;
  }

  /**
   * Simula la llegada de un evento de ejecución ("Fill") de orden
   */
  public simulateOrderFill(event: OrderExecutionEvent): void {
    const parseResult = OrderExecutionEventSchema.safeParse(event);
    if (parseResult.success) {
      this.emit('order:filled', parseResult.data);
    } else {
      console.error('[MockExchangeStreams Error] Evento simulado inválido:', parseResult.error.format());
    }
  }
}
