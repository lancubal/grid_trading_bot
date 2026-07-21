import { z } from 'zod';
import Decimal from 'decimal.js';

export const OrderSideSchema = z.enum(['buy', 'sell']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(['limit', 'market']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const OrderStatusSchema = z.enum(['pending', 'open', 'closed', 'canceled', 'expired', 'rejected']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * Zod Schema para eventos de actualización de órdenes recibidos vía WebSockets/REST
 */
export const OrderExecutionEventSchema = z.object({
  id: z.string(),
  clientOrderId: z.string().optional(),
  symbol: z.string(),
  side: OrderSideSchema,
  type: OrderTypeSchema,
  price: z.instanceof(Decimal),
  amount: z.instanceof(Decimal),
  filled: z.instanceof(Decimal),
  remaining: z.instanceof(Decimal),
  status: OrderStatusSchema,
  timestamp: z.number(),
  gridLevel: z.number().int().optional(),
});

export type OrderExecutionEvent = z.infer<typeof OrderExecutionEventSchema>;

/**
 * Estructura interna de un Nivel de la Grilla (Grid Level)
 */
export interface GridLevel {
  levelIndex: number;
  price: Decimal;
  buyOrderId?: string;
  sellOrderId?: string;
  state: 'empty' | 'buy_placed' | 'sell_placed' | 'filled';
}

/**
 * Tipos de Eventos del Bus Interno (EventEmitter)
 */
export interface SystemEvents {
  'ticker:updated': (data: { symbol: string; price: Decimal; timestamp: number }) => void;
  'order:created': (order: OrderExecutionEvent) => void;
  'order:filled': (order: OrderExecutionEvent) => void;
  'order:canceled': (orderId: string) => void;
  'grid:rebalanced': (details: { level: number; side: OrderSide; price: Decimal }) => void;
  'error': (error: Error) => void;
}
