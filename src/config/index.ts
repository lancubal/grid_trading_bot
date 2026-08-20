import 'dotenv/config';
import { z } from 'zod';
import Decimal from 'decimal.js';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Modo de Ejecución (Shadow Trading / Dry-Run vs Producción Real)
  DRY_RUN: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),

  // Parámetros del Grid Adaptativo (ATR)
  GRID_SYMBOL: z.string().default('BTC/USDT'),
  GRID_LEVELS: z.coerce.number().int().min(3).max(100).default(9),
  GRID_INVESTMENT: z
    .string()
    .transform((val) => new Decimal(val))
    .default('10000.00'),
  ATR_PERIOD: z.coerce.number().int().min(2).max(100).default(19),
  ATR_TIMEFRAME: z.string().default('1h'),
  ATR_MULTIPLIER: z.coerce.number().default(2.0),
  MIN_GRID_RANGE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('6996.00'),
  MAX_GRID_RANGE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('8846.00'),

  // Cortacircuitos de Velocidad (Circuit Breaker)
  CIRCUIT_BREAKER_DROP_PCT: z.coerce.number().default(7.4),
  CIRCUIT_BREAKER_WINDOW_MINS: z.coerce.number().int().default(29),
  CIRCUIT_BREAKER_COOLDOWN_HOURS: z.coerce.number().default(2.0),

  // Bloqueo FOMO (Escudo Anti-Comprar la Cima de un Pump)
  FOMO_COOLDOWN_HOURS: z.coerce.number().default(11.5),

  // Guardián de Deriva Proactiva de Precio (Price Drift Trigger)
  PRICE_DRIFT_UPPER_THRESHOLD: z.coerce.number().default(0.89),
  PRICE_DRIFT_LOWER_THRESHOLD: z.coerce.number().default(0.15),
  PRICE_DRIFT_COOLDOWN_MINS: z.coerce.number().int().default(38),

  // Grilla Asimétrica & Compounding Continuo
  ENABLE_CONTINUOUS_COMPOUNDING: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),
  TAKE_PROFIT_MULTIPLIER: z.coerce.number().default(1.8),
  BUY_CAPITAL_WEIGHT: z.coerce.number().default(0.52),

  // Arquitectura de Doble Capa (Micro-Grid + Macro-Grid)
  ENABLE_DUAL_LAYER: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),
  MICRO_CAPITAL_RATIO: z.coerce.number().default(0.25),
  MICRO_GRID_RANGE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('2241.00'),
  MICRO_GRID_LEVELS: z.coerce.number().int().default(6),

  // Orquestador de Régimen de Mercado (Control Integral PID) - Apagado por defecto
  ENABLE_REGIME_ORCHESTRATOR: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('false'),
  REGIME_THRESHOLD_PCT: z.coerce.number().default(1.09),

  // Parámetros de Riesgo y Blindaje de Capital
  MAX_ORDER_VALUE_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('2000.00'),
  MAX_GRID_ALLOCATION_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('20000.00'),
  MAX_OPEN_ORDERS: z.coerce.number().int().default(40),

  // Firewall de Autodefensa de Capital y Alerta de Sed (Binance Simple Earn Flexible)
  ENABLE_AUTO_INJECT: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('false'),
  STARVATION_THRESHOLD_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('150.00'),
  AUTO_INJECT_COOLDOWN_DAYS: z.coerce.number().int().default(20),
  AUTO_INJECT_AMOUNT_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('1000.00'),
  MAX_LIFETIME_ALLOCATION_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('2000.00'),

  // Alertas y Observabilidad (Slack Notifications & Kill-Switch)
  ENABLE_NOTIFICATIONS: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),
  SLACK_WEBHOOK_URL: z
    .string()
    .optional()
    .default(''),

  // Módulo Autónomo de Auto-Recarga de BNB para Comisiones
  ENABLE_AUTO_BNB_REFILL: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .default('true'),
  BNB_MIN_THRESHOLD_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('25.00'),
  BNB_REFILL_AMOUNT_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('50.00'),
  BNB_REFILL_COOLDOWN_HOURS: z.coerce.number().default(12.0),
  BNB_SAFETY_USDT_BUFFER_USD: z
    .string()
    .transform((val) => new Decimal(val))
    .default('50.00'),

  // Base de Datos PostgreSQL
  DATABASE_URL: z.string().url().default('postgresql://user:pass@localhost:5432/botdb'),

  // Exchange Config
  EXCHANGE_ID: z.string().default('binance'),
  EXCHANGE_API_KEY: z.string().optional().default(''),
  EXCHANGE_API_SECRET: z.string().optional().default(''),
  BINANCE_API_KEY: z.string().optional().default(''),
  BINANCE_API_SECRET: z.string().optional().default(''),
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

  const data = parsed.data;

  // Unificar llaves si se especifican BINANCE_API_KEY / BINANCE_API_SECRET
  if (data.BINANCE_API_KEY && !data.EXCHANGE_API_KEY) {
    data.EXCHANGE_API_KEY = data.BINANCE_API_KEY;
  }
  if (data.BINANCE_API_SECRET && !data.EXCHANGE_API_SECRET) {
    data.EXCHANGE_API_SECRET = data.BINANCE_API_SECRET;
  }

  return data;
}

export interface GridConfigInput {
  symbol: string;
  lowerPrice: Decimal;
  upperPrice: Decimal;
  gridLevels: number;
  investment: Decimal;
  atrPeriod?: number;
  atrTimeframe?: string;
  atrMultiplier?: number;
  minGridRangeUsd?: Decimal;
  maxGridRangeUsd?: Decimal;
  takeProfitMultiplier?: number;
  buyCapitalWeight?: number;
  enableDualLayer?: boolean;
  microCapitalRatio?: number;
  microGridRangeUsd?: Decimal;
  microGridLevels?: number;
  enableRegimeOrchestrator?: boolean;
  regimeThresholdPct?: number;
}

export function getGridConfigFromEnv(env: EnvConfig): GridConfigInput {
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
    atrMultiplier: env.ATR_MULTIPLIER,
    minGridRangeUsd: env.MIN_GRID_RANGE_USD,
    maxGridRangeUsd: env.MAX_GRID_RANGE_USD,
    takeProfitMultiplier: env.TAKE_PROFIT_MULTIPLIER,
    buyCapitalWeight: env.BUY_CAPITAL_WEIGHT,
    enableDualLayer: env.ENABLE_DUAL_LAYER,
    microCapitalRatio: env.MICRO_CAPITAL_RATIO,
    microGridRangeUsd: env.MICRO_GRID_RANGE_USD,
    microGridLevels: env.MICRO_GRID_LEVELS,
    enableRegimeOrchestrator: env.ENABLE_REGIME_ORCHESTRATOR,
    regimeThresholdPct: env.REGIME_THRESHOLD_PCT,
  };
}
