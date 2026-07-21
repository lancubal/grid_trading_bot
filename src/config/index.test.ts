import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { getGridConfigFromEnv, GridConfigSchema } from './index';

describe('Config - Dynamic Grid & Env Validation Tests', () => {
  it('debe parsear y validar la configuración de grilla desde variables de entorno', () => {
    const mockEnv = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/grid_bot?schema=public',
      EXCHANGE_ID: 'binance',
      EXCHANGE_API_KEY: '',
      EXCHANGE_SECRET: '',
      EXCHANGE_TESTNET: true,
      GRID_SYMBOL: 'BTC/USDT',
      GRID_LOWER_PRICE: '55000.00',
      GRID_UPPER_PRICE: '62000.00',
      GRID_LEVELS: 8,
      GRID_INVESTMENT: '2000.00',
      MAX_ORDER_VALUE_USD: '10000.00',
      MAX_OPEN_ORDERS: 50,
    };

    const gridConfig = getGridConfigFromEnv(mockEnv as any);

    expect(gridConfig.symbol).toBe('BTC/USDT');
    expect(gridConfig.lowerPrice.toString()).toBe('55000');
    expect(gridConfig.upperPrice.toString()).toBe('62000');
    expect(gridConfig.gridLevels).toBe(8);
    expect(gridConfig.investment.toString()).toBe('2000');
  });

  it('debe rechazar una grilla donde el precio superior sea menor o igual al inferior', () => {
    const invalidConfig = {
      symbol: 'BTC/USDT',
      lowerPrice: new Decimal('65000.00'),
      upperPrice: new Decimal('60000.00'), // Inválido: upper < lower
      gridLevels: 5,
      investment: new Decimal('1000.00'),
    };

    expect(() => GridConfigSchema.parse(invalidConfig)).toThrow();
  });
});
