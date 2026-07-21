import Decimal from 'decimal.js';
import { OrderRequest } from '../exchange/adapter';

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
}
