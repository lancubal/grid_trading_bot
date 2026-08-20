import Decimal from 'decimal.js';
import { IExchangeAdapter, isInsufficientFundsError } from '../exchange/adapter';
import { SlackNotifier } from './notifier';

export interface AutoBnbFeeManagerConfig {
  enabled: boolean;
  minThresholdUsd: Decimal;
  refillAmountUsd: Decimal;
  cooldownHours: number;
  safetyUsdtBufferUsd: Decimal;
  isDryRun?: boolean;
}

export interface RefillEvaluationResult {
  refilled: boolean;
  reason: string;
  bnbAmount?: Decimal;
  bnbPrice?: Decimal;
  usdtCost?: Decimal;
  currentBnbBalance?: Decimal;
  currentBnbValueUsd?: Decimal;
}

/**
 * Módulo Autónomo de Auto-Recarga de BNB para Comisiones.
 * Monitorea el saldo libre de BNB en Binance Spot y compra automáticamente
 * una pequeña cantidad fija de BNB usando USDT libre cuando el saldo cae por debajo
 * del umbral de seguridad, sin desbalancear ni quitar fondos a la grilla activa de BTC/USDT.
 */
export class AutoBnbFeeManager {
  private readonly config: AutoBnbFeeManagerConfig;
  private lastRefillTimestamp: number = 0;

  constructor(config: AutoBnbFeeManagerConfig) {
    this.config = config;
  }

  public getStatus() {
    const cooldownMs = this.config.cooldownHours * 60 * 60 * 1000;
    const now = Date.now();
    const timeSinceLastRefill = now - this.lastRefillTimestamp;
    const isCooldownActive = this.lastRefillTimestamp > 0 && timeSinceLastRefill < cooldownMs;
    const nextAllowedRefillTime = this.lastRefillTimestamp + cooldownMs;

    return {
      enabled: this.config.enabled,
      lastRefillTimestamp: this.lastRefillTimestamp,
      isCooldownActive,
      nextAllowedRefillTime,
    };
  }

  public setLastRefillTimestamp(timestamp: number): void {
    this.lastRefillTimestamp = timestamp;
  }

  /**
   * Evalúa el balance de BNB y ejecuta la compra si se cumplen todas las condiciones de seguridad
   */
  public async evaluateAndRefill(
    exchangeAdapter: IExchangeAdapter,
    notifier?: SlackNotifier
  ): Promise<RefillEvaluationResult> {
    if (!this.config.enabled) {
      return { refilled: false, reason: 'Módulo de auto-recarga de BNB deshabilitado' };
    }

    const now = Date.now();
    const cooldownMs = this.config.cooldownHours * 60 * 60 * 1000;
    if (this.lastRefillTimestamp > 0 && now - this.lastRefillTimestamp < cooldownMs) {
      const remainingMins = Math.ceil((cooldownMs - (now - this.lastRefillTimestamp)) / (60 * 1000));
      return { refilled: false, reason: `En período de cooldown (restan ${remainingMins} mins)` };
    }

    try {
      // 1. Consultar balance real en Binance Spot
      const balance = await exchangeAdapter.fetchBalance();
      const bnbFree = balance.free['BNB'] ? new Decimal(balance.free['BNB']) : new Decimal(0);
      const usdtFree = balance.free['USDT'] ? new Decimal(balance.free['USDT']) : new Decimal(0);

      // 2. Consultar precio actual de BNB/USDT
      let bnbPrice = new Decimal(570); // Fallback razonable
      try {
        const ticker = await exchangeAdapter.fetchTicker('BNB/USDT');
        if (ticker && ticker.last && ticker.last.greaterThan(0)) {
          bnbPrice = ticker.last;
        }
      } catch (err: any) {
        console.warn('[AutoBnbFeeManager Warning] No se pudo consultar ticker BNB/USDT, usando fallback $570 USD:', err.message || err);
      }

      const currentBnbValueUsd = bnbFree.times(bnbPrice);

      // 3. Evaluar si el saldo de BNB es inferior al umbral mínimo
      if (currentBnbValueUsd.greaterThanOrEqualTo(this.config.minThresholdUsd)) {
        return {
          refilled: false,
          reason: `Saldo BNB suficiente: ${bnbFree.toFixed(4)} BNB (~$${currentBnbValueUsd.toFixed(2)} USD >= $${this.config.minThresholdUsd.toFixed(2)} USD)`,
          currentBnbBalance: bnbFree,
          currentBnbValueUsd,
        };
      }

      // 4. Blindaje de Seguridad: Verificar que el saldo libre de USDT cubra la recarga + el colchón de seguridad
      const requiredUsdt = this.config.refillAmountUsd.plus(this.config.safetyUsdtBufferUsd);
      if (usdtFree.lessThan(requiredUsdt)) {
        console.warn(
          `[AutoBnbFeeManager Alert] ⚠️ Saldo libre en USDT ($${usdtFree.toFixed(2)} USDT) es inferior al mínimo de resguardo requerido ($${requiredUsdt.toFixed(2)} USDT) para comprar BNB sin tocar la grilla de BTC. Postergando recarga.`
        );
        return {
          refilled: false,
          reason: `USDT libre insuficiente ($${usdtFree.toFixed(2)} < $${requiredUsdt.toFixed(2)} USD)`,
          currentBnbBalance: bnbFree,
          currentBnbValueUsd,
        };
      }

      // 5. Calcular cantidad de BNB a comprar (redondeado a 4 decimales para Binance Spot)
      const rawBnbAmount = this.config.refillAmountUsd.dividedBy(bnbPrice);
      const bnbAmountToBuy = new Decimal(rawBnbAmount.toFixed(4, Decimal.ROUND_DOWN));

      if (bnbAmountToBuy.lessThanOrEqualTo(0.001)) {
        return {
          refilled: false,
          reason: `Monto BNB calculado (${bnbAmountToBuy.toFixed(4)}) inferior al mínimo operativo`,
          currentBnbBalance: bnbFree,
          currentBnbValueUsd,
        };
      }

      const estimatedCostUsd = bnbAmountToBuy.times(bnbPrice);

      console.log(
        `\n[AutoBnbFeeManager] 🪙 Saldo bajo de BNB detectado: ${bnbFree.toFixed(4)} BNB (~$${currentBnbValueUsd.toFixed(2)} USD < $${this.config.minThresholdUsd.toFixed(2)} USD).`
      );
      console.log(
        `[AutoBnbFeeManager] 🚀 Ejecutando compra autónoma de ${bnbAmountToBuy.toFixed(4)} BNB (~$${estimatedCostUsd.toFixed(2)} USD @ $${bnbPrice.toFixed(2)} BNB/USDT)...`
      );

      // 6. Ejecutar orden de compra en Binance Spot
      if (!this.config.isDryRun) {
        try {
          await exchangeAdapter.createOrder({
            symbol: 'BNB/USDT',
            type: 'market',
            side: 'buy',
            amount: bnbAmountToBuy,
          });
        } catch (err: any) {
          if (isInsufficientFundsError(err)) {
            console.error('[AutoBnbFeeManager Error] Fondos insuficientes en Binance para comprar BNB (-2010):', err.message || err);
          } else {
            console.error('[AutoBnbFeeManager Error] Error al ejecutar orden de compra BNB/USDT:', err.message || err);
          }
          return {
            refilled: false,
            reason: `Error al crear orden en Binance: ${err.message || err}`,
            currentBnbBalance: bnbFree,
            currentBnbValueUsd,
          };
        }
      } else {
        console.log(`[AutoBnbFeeManager Mock] Modo DRY_RUN: Compra de ${bnbAmountToBuy.toFixed(4)} BNB simulada exitosamente.`);
      }

      this.lastRefillTimestamp = now;

      // 7. Notificar a Slack en tiempo real
      if (notifier && notifier.isEnabled()) {
        await notifier.sendSlackMessage(
          `🪙 *AUTO-RECARGA AUTÓNOMA DE BNB EJECUTADA*\n` +
          `• *Motivo:* Saldo previo bajo ($${currentBnbValueUsd.toFixed(2)} USD < $${this.config.minThresholdUsd.toFixed(2)} USD)\n` +
          `• *Comprado:* +${bnbAmountToBuy.toFixed(4)} BNB (~$${estimatedCostUsd.toFixed(2)} USD @ $${bnbPrice.toFixed(2)} USD)\n` +
          `• *Nuevo Saldo Estimado:* ~${bnbFree.plus(bnbAmountToBuy).toFixed(4)} BNB\n` +
          `• *Estado Grilla BTC/USDT:* Operando intacta con 25% de descuento en comisiones activo 🚀`
        );
      }

      console.log(`[AutoBnbFeeManager Complete] ✅ Recarga de BNB completada exitosamente. Cooldown de ${this.config.cooldownHours}h activado.\n`);

      return {
        refilled: true,
        reason: 'Recarga completada exitosamente',
        bnbAmount: bnbAmountToBuy,
        bnbPrice,
        usdtCost: estimatedCostUsd,
        currentBnbBalance: bnbFree.plus(bnbAmountToBuy),
        currentBnbValueUsd: bnbFree.plus(bnbAmountToBuy).times(bnbPrice),
      };
    } catch (err: any) {
      console.error('[AutoBnbFeeManager Exception] Error durante evaluación de recarga de BNB:', err.message || err);
      return {
        refilled: false,
        reason: `Excepción: ${err.message || err}`,
      };
    }
  }
}
