import { describe, it, expect } from 'vitest';
import { EnvSchema } from './index';

describe('Config - Zod Schema Validation Tests', () => {
  it('debe validar y transformar correctamente variables de entorno válidas incluyendo DRY_RUN y ATR', () => {
    const mockEnv = {
      NODE_ENV: 'development',
      PORT: '3000',
      DRY_RUN: 'true',
      GRID_SYMBOL: 'BTC/USDT',
      GRID_LEVELS: '15',
      GRID_INVESTMENT: '1000.00',
      ATR_PERIOD: '14',
      ATR_TIMEFRAME: '1h',
      MIN_GRID_RANGE_USD: '1500.00',
      MAX_GRID_RANGE_USD: '6000.00',
      MAX_ORDER_VALUE_USD: '150.00',
      MAX_OPEN_ORDERS: '20',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/grid_bot?schema=public',
      EXCHANGE_ID: 'binance',
      EXCHANGE_TESTNET: 'true',
    };

    const parsed = EnvSchema.parse(mockEnv);
    expect(parsed.DRY_RUN).toBe(true);
    expect(parsed.GRID_SYMBOL).toBe('BTC/USDT');
    expect(parsed.GRID_LEVELS).toBe(15);
    expect(parsed.GRID_INVESTMENT.toString()).toBe('1000');
    expect(parsed.ATR_PERIOD).toBe(14);
    expect(parsed.ATR_TIMEFRAME).toBe('1h');
    expect(parsed.MIN_GRID_RANGE_USD.toString()).toBe('1500');
    expect(parsed.MAX_GRID_RANGE_USD.toString()).toBe('6000');
  });

  it('debe arrojar error de Zod si DATABASE_URL no es una URL válida', () => {
    const invalidEnv = {
      DATABASE_URL: 'not-a-valid-url',
    };

    expect(() => EnvSchema.parse(invalidEnv)).toThrow();
  });
});
