import { EventEmitter } from 'events';
import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { AtrCalculator } from './atrCalculator';
import { OHLCV } from '../backtest/backtester';

export class LiveVolatilityEngine extends EventEmitter {
  private currentActiveAtr: Decimal | null = null;
  private readonly thresholdPercent: Decimal;
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(thresholdPercent: number = 15) {
    super();
    this.thresholdPercent = new Decimal(thresholdPercent);
  }

  public getCurrentAtr(): Decimal | null {
    return this.currentActiveAtr;
  }

  /**
   * Inicializa la escucha de velas de 1 hora y el cálculo continuo de volatilidad ATR
   */
  public async start(symbol: string, timeframe: string = '1h', period: number = 14): Promise<void> {
    this.isRunning = true;
    const ccxtPublic = new ccxt.binance({ enableRateLimit: true });

    console.log(`[Volatility Engine] 📡 Iniciado monitoreo de volatilidad en vivo para ${symbol} (${timeframe}, ATR-${period})...`);

    // Primera evaluación inmediata
    await this.evaluateVolatility(ccxtPublic, symbol, timeframe, period);

    // Evaluar cada 60 segundos si se ha cerrado/actualizado una vela de 1h
    this.intervalTimer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.evaluateVolatility(ccxtPublic, symbol, timeframe, period);
      } catch (err) {
        console.error('[Volatility Engine Error] Error evaluando volatilidad:', err);
      }
    }, 60000);
  }

  /**
   * Evalúa la variación porcentual del ATR y emite VOLATILITY_CHANGE si varía >= 15%
   */
  public async evaluateVolatility(
    ccxtClient: any,
    symbol: string,
    timeframe: string,
    period: number
  ): Promise<Decimal | null> {
    try {
      let rawCandles: any[] = [];
      const cleanSymbol = symbol.replace('/', '');

      // Intento 1: Usar cliente CCXT (o mock en pruebas unitarias)
      if (ccxtClient && typeof ccxtClient.fetchOHLCV === 'function') {
        try {
          rawCandles = await ccxtClient.fetchOHLCV(symbol, timeframe, undefined, period + 10);
        } catch (err: any) {
          // Ignorar 451 y pasar a fallback REST
        }
      }

      // Intento 2: API pública REST de Binance US (Acceso global garantizado sin bloqueo HTTP 451 en AWS US)
      if (!rawCandles || rawCandles.length === 0) {
        try {
          const res = await fetch(`https://api.binance.us/api/v3/klines?symbol=${cleanSymbol}&interval=${timeframe}&limit=${period + 10}`);
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            rawCandles = data;
          }
        } catch (err) {
          // Fallback a Intento 3
        }
      }

      // Intento 3: API pública REST de Binance Global
      if (!rawCandles || rawCandles.length === 0) {
        try {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${timeframe}&limit=${period + 10}`);
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            rawCandles = data;
          }
        } catch (err) {
          // Ignores
        }
      }

      if (!rawCandles || !Array.isArray(rawCandles) || rawCandles.length < period + 1) return null;

      const candles: OHLCV[] = rawCandles.map((c: any) => ({
        timestamp: typeof c[0] === 'number' ? c[0] : Date.now(),
        open: new Decimal(c[1] ?? 0),
        high: new Decimal(c[2] ?? 0),
        low: new Decimal(c[3] ?? 0),
        close: new Decimal(c[4] ?? 0),
        volume: new Decimal(c[5] ?? 0),
      }));

      const newAtr = AtrCalculator.calculate(candles, period);

      if (this.currentActiveAtr === null) {
        this.currentActiveAtr = newAtr;
        console.log(`[Volatility Engine] 📊 ATR Inicial registrado: $${newAtr.toFixed(2)} USD`);
        return newAtr;
      }

      const diffAbs = newAtr.minus(this.currentActiveAtr).abs();
      const variationPercent = diffAbs.dividedBy(this.currentActiveAtr).times(100);

      if (variationPercent.greaterThanOrEqualTo(this.thresholdPercent)) {
        console.log(
          `[Volatility Engine] 🚀 CAMBIO DE VOLATILIDAD (Variación: ${variationPercent.toFixed(2)}% >= ${this.thresholdPercent}%): ATR anterior $${this.currentActiveAtr.toFixed(2)} ➔ Nuevo ATR $${newAtr.toFixed(2)} USD`
        );

        this.currentActiveAtr = newAtr;
        this.emit('VOLATILITY_CHANGE', newAtr);
      }

      return newAtr;
    } catch (err) {
      console.warn('[Volatility Engine Warning] Error consultando velas OHLCV:', err);
      return null;
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    console.log('[Volatility Engine] 🛑 Monitoreo de volatilidad detenido.');
  }
}
