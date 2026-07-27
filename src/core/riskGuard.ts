import Decimal from 'decimal.js';
import { OrderRequest } from '../exchange/adapter';

export interface AutoInjectionValidationParams {
  currentUsdtCash: Decimal | number;
  isInsufficientFunds?: boolean;
  starvationThresholdUsd?: Decimal | number;
  lastInjectionTimestamp?: Date | string | number | null;
  autoInjectCooldownDays?: number;
  currentLifetimeAllocationUsd: Decimal | number;
  autoInjectAmountUsd?: Decimal | number;
  maxLifetimeAllocationUsd?: Decimal | number;
}

export class RiskGuard {
  private maxOrderValueUsd: Decimal;
  private maxOpenOrders: number;
  private maxGridAllocationUsd: Decimal;

  constructor(
    maxOrderValueUsd: Decimal | number = new Decimal(150),
    maxOpenOrders = 20,
    maxGridAllocationUsd: Decimal | number = new Decimal(2000)
  ) {
    this.maxOrderValueUsd = new Decimal(maxOrderValueUsd);
    this.maxOpenOrders = maxOpenOrders;
    this.maxGridAllocationUsd = new Decimal(maxGridAllocationUsd);
  }

  public getMaxGridAllocationUsd(): Decimal {
    return this.maxGridAllocationUsd;
  }

  /**
   * Valida si una orden solicitada cumple con las reglas de gestión de riesgo
   * y blindaje de capital asignado.
   */
  public validateOrder(
    order: OrderRequest,
    currentOpenOrdersCount: number,
    currentOpenAllocationUsd: Decimal | number = new Decimal(0)
  ): { valid: boolean; reason?: string } {
    if (currentOpenOrdersCount >= this.maxOpenOrders) {
      return {
        valid: false,
        reason: `Límite máximo de órdenes abiertas alcanzado (${this.maxOpenOrders})`,
      };
    }

    if (order.type !== 'limit') {
      return {
        valid: false,
        reason: 'Gestión de Riesgo: Solo se permiten órdenes de tipo LIMIT (Maker) para evitar comisiones Taker',
      };
    }

    if (!order.price || new Decimal(order.price).isZero()) {
      return {
        valid: false,
        reason: 'Gestión de Riesgo: Las órdenes LIMIT requieren especificar un precio válido',
      };
    }

    const priceDec = new Decimal(order.price);
    const amountDec = new Decimal(order.amount);
    const totalOrderValue = priceDec.times(amountDec);

    if (totalOrderValue.greaterThan(this.maxOrderValueUsd)) {
      return {
        valid: false,
        reason: `Valor de la orden ($${totalOrderValue.toFixed(2)}) supera el límite individual de riesgo ($${this.maxOrderValueUsd.toFixed(2)})`,
      };
    }

    const currentAllocationDec = new Decimal(currentOpenAllocationUsd);
    const projectedAllocation = currentAllocationDec.plus(totalOrderValue);

    if (projectedAllocation.greaterThan(this.maxGridAllocationUsd)) {
      return {
        valid: false,
        reason: `Blindaje de Capital: La asignación proyectada ($${projectedAllocation.toFixed(2)}) superaría el máximo permitido para la grilla ($${this.maxGridAllocationUsd.toFixed(2)} USD)`,
      };
    }

    return { valid: true };
  }

  /**
   * Evalúa las 3 Reglas del Firewall de Autodefensa de Capital para inyección autónoma desde Binance Simple Earn:
   * - Regla A: Disparador de Sed (Saldo < $150 USDT o Rechazo por Insufficient Funds)
   * - Regla B: Cooldown Temporal Estricto (Bloqueo si transcurrieron menos de N días desde la última inyección)
   * - Regla C: Techo Patrimonial Inviolable (Bloqueo si el capital acumulado supera MAX_LIFETIME_ALLOCATION_USD)
   */
  public validateAutoInjection(params: AutoInjectionValidationParams): { valid: boolean; reason?: string } {
    const starvationThreshold = new Decimal(params.starvationThresholdUsd ?? 150);
    const cooldownDays = params.autoInjectCooldownDays ?? 20;
    const injectAmount = new Decimal(params.autoInjectAmountUsd ?? 1000);
    const maxLifetimeAllocation = new Decimal(params.maxLifetimeAllocationUsd ?? 10000);
    const currentLifetimeAllocation = new Decimal(params.currentLifetimeAllocationUsd);
    const currentUsdtCash = new Decimal(params.currentUsdtCash);

    // REGLA A: Disparador de Sed (Suelo de Liquidez)
    const isStarved = currentUsdtCash.lessThan(starvationThreshold) || params.isInsufficientFunds === true;
    if (!isStarved) {
      return {
        valid: false,
        reason: `Regla A (Suelo de Liquidez): El disponible ($${currentUsdtCash.toFixed(2)} USDT) está por encima del umbral de sed ($${starvationThreshold.toFixed(2)} USDT)`,
      };
    }

    // REGLA B: Cooldown Temporal Estricto
    if (params.lastInjectionTimestamp) {
      const lastInjectionDate = new Date(params.lastInjectionTimestamp);
      const now = new Date();
      const diffMs = now.getTime() - lastInjectionDate.getTime();
      const diffDays = diffMs / (1000 * 3600 * 24);

      if (diffDays < cooldownDays) {
        const remainingDays = (cooldownDays - diffDays).toFixed(1);
        return {
          valid: false,
          reason: `Regla B (Cooldown Estricto): Transcurrieron ${diffDays.toFixed(1)} días de los ${cooldownDays} días requeridos. Faltan ${remainingDays} días.`,
        };
      }
    }

    // REGLA C: Techo Patrimonial Inviolable
    const projectedLifetimeAllocation = currentLifetimeAllocation.plus(injectAmount);
    if (projectedLifetimeAllocation.greaterThan(maxLifetimeAllocation)) {
      return {
        valid: false,
        reason: `Regla C (Techo Patrimonial Inviolable): La inyección proyectada ($${projectedLifetimeAllocation.toFixed(2)}) superaría el techo máximo asignado ($${maxLifetimeAllocation.toFixed(2)} USD)`,
      };
    }

    return { valid: true };
  }
}
