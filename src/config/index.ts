import { z } from 'zod';
import Decimal from 'decimal.js';

/**
 * Schema Zod para validar la configuración del entorno (.env)
 */
export const EnvConfigSchema = z.object({
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/grid_bot?schema=public'),
  EXCHANGE_ID: z.string().default('binance'),
  EXCHANGE_API_KEY: z.string().optional().default(''),
  EXCHANGE_SECRET: z.string().optional().default(''),
  EXCHANGE_TESTNET: z
    .string()
    .transform((val) => val === 'true')
    .default('true'),

  // Parámetros dinámicos de la Grilla
  GRID_SYMBOL: z.string().default('BTC/USDT'),
  GRID_LOWER_PRICE: z.string().default('60000.00'),
  GRID_UPPER_PRICE: z.string().default('65000.00'),
  GRID_LEVELS: z.string().transform((val) => parseInt(val, 10)).default('6'),
  GRID_INVESTMENT: z.string().default('1000.00'),

  // Gestión de Riesgo
  MAX_ORDER_VALUE_USD: z.string().default('10000.00'),
  MAX_OPEN_ORDERS: z.string().transform((val) => parseInt(val, 10)).default('50'),
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;

/**
 * Schema Zod para validar los parámetros de configuración de la grilla (Grid Trading)
 */
export const GridConfigSchema = z.object({
  symbol: z.string().default('BTC/USDT'),
  upperPrice: z.instanceof(Decimal).refine((val) => val.greaterThan(0), {
    message: 'El precio superior debe ser mayor a 0',
  }),
  lowerPrice: z.instanceof(Decimal).refine((val) => val.greaterThan(0), {
    message: 'El precio inferior debe ser mayor a 0',
  }),
  gridLevels: z.number().int().min(2, 'La grilla debe tener al menos 2 niveles'),
  investment: z.instanceof(Decimal).refine((val) => val.greaterThan(0), {
    message: 'La inversión debe ser mayor a 0',
  }),
}).refine((data) => data.upperPrice.greaterThan(data.lowerPrice), {
  message: 'El precio superior debe ser estrictamente mayor al precio inferior',
  path: ['upperPrice'],
});

export type GridConfigInput = z.infer<typeof GridConfigSchema>;

export function loadEnvConfig(): EnvConfig {
  return EnvConfigSchema.parse(process.env);
}

/**
 * Extrae y valida la configuración de la grilla a partir del entorno
 */
export function getGridConfigFromEnv(env?: EnvConfig): GridConfigInput {
  const currentEnv = env || loadEnvConfig();

  return GridConfigSchema.parse({
    symbol: currentEnv.GRID_SYMBOL,
    lowerPrice: new Decimal(currentEnv.GRID_LOWER_PRICE),
    upperPrice: new Decimal(currentEnv.GRID_UPPER_PRICE),
    gridLevels: currentEnv.GRID_LEVELS,
    investment: new Decimal(currentEnv.GRID_INVESTMENT),
  });
}
