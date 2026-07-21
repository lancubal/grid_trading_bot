import 'dotenv/config';
import { z } from 'zod';
import Decimal from 'decimal.js';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Modo de Ejecución (Shadow Trading / Dry Run)
  DRY_RUN: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),

  // Parámetros del Grid Adaptativo (ATR)
  GRID_SYMBOL: z.string().default('BTC/USDT'),
  GRID_LEVELS: z.coerce.number().int().min(3).max(100).default(15),
  GRID_INVESTMENT: z
    .string()
    .transform((val) => new Decimal(val))
    .default('1000.00'),
  ATR_PERIOD: z.coerce.number().int().min(2).max(100).default(14),
  ATR_TIMEFRAME: z.string().default('1h'),
  MIN_GRID_RANGE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('1500.00'),
  MAX_GRID_RANGE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('6000.00'),

  // Parámetros de Riesgo
  MAX_ORDER_VALUE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('150.00'),
  MAX_OPEN_ORDERS: z.coerce.number().int().default(20),

  // Base de Datos PostgreSQL
  DATABASE_URL: z.string().url(),

  // Exchange Config
  EXCHANGE_ID: z.string().default('binance'),
  EXCHANGE_API_KEY: z.string().optional().default(''),
  EXCHANGE_API_SECRET: z.string().optional().default(''),
  EXCHANGE_TESTNET: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadEnvConfig(): EnvConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Configuración de entorno no válida:', parsed.error.format());
    throw new Error('Configuración de entorno inválida.');
  }
  return parsed.data;
}

export interface GridConfigInput {
  symbol: string;
  lowerPrice: Decimal;
  upperPrice: Decimal;
  gridLevels: number;
  investment: Decimal;
  atrPeriod?: number;
  atrTimeframe?: string;
  minGridRangeUsd?: Decimal;
  maxGridRangeUsd?: Decimal;
}

export function getGridConfigFromEnv(env: EnvConfig): GridConfigInput {
  // Rango inicial fallback si no se especifican precios explícitos
  const lowerPrice = new Decimal(process.env.GRID_LOWER_PRICE || '63000.00');
  const upperPrice = new Decimal(process.env.GRID_UPPER_PRICE || '66000.00');

  return {
    symbol: env.GRID_SYMBOL,
    lowerPrice,
    upperPrice,
    gridLevels: env.GRID_LEVELS,
    investment: env.GRID_INVESTMENT,
    atrPeriod: env.ATR_PERIOD,
    atrTimeframe: env.ATR_TIMEFRAME,
    minGridRangeUsd: env.MIN_GRID_RANGE_USD,
    maxGridRangeUsd: env.MAX_GRID_RANGE_USD,
  };
}
