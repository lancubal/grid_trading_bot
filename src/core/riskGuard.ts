import Decimal from 'decimal.js';
import { OrderRequest } from '../exchange/adapter';

export class RiskGuard {
  private maxOrderValueUsd: Decimal;
  private maxOpenOrders: number;

  constructor(maxOrderValueUsd: Decimal | number = new Decimal(150), maxOpenOrders = 20) {
    this.maxOrderValueUsd = new Decimal(maxOrderValueUsd);
    this.maxOpenOrders = maxOpenOrders;
  }

  /**
   * Valida si una orden solicitada cumple con las reglas de gestión de riesgo.
   * Regla de Oro: Solo se permiten órdenes de tipo LIMIT (Maker) para evitar
   * comisiones Taker (0.20%) que erosionen la rentabilidad de la grilla.
   */
  public validateOrder(order: OrderRequest, currentOpenOrdersCount: number): { valid: boolean; reason?: string } {
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

    if (order.price) {
      const priceDec = new Decimal(order.price);
      const amountDec = new Decimal(order.amount);
      const totalOrderValue = priceDec.times(amountDec);

      if (totalOrderValue.greaterThan(this.maxOrderValueUsd)) {
        return {
          valid: false,
          reason: `Valor de la orden ($${totalOrderValue.toFixed(2)}) supera el límite de riesgo ($${this.maxOrderValueUsd.toFixed(2)})`,
        };
      }
    }

    return { valid: true };
  }
}
