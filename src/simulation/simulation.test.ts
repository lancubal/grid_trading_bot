import { describe, it, expect } from 'vitest';
import { FitnessCalculator } from './fitness';
import { MemoryEngine, BotHyperparameters } from './memoryEngine';
import { CandleBuffer } from './datasetLoader';
import { RandomSearchOptimizer, DEFAULT_PARAM_SPACE } from './randomSearch';
import { GeneticOptimizer } from './geneticOptimizer';

describe('Simulation & Genetic Optimizer Test Suite', () => {
  const sampleParams: BotHyperparameters = {
    gridLevels: 15,
    investment: 2000,
    atrPeriod: 14,
    atrTimeframeMinutes: 60,
    atrMultiplier: 6.0,
    minGridRangeUsd: 4000,
    maxGridRangeUsd: 6000,
    priceDriftUpperThreshold: 0.80,
    priceDriftLowerThreshold: 0.20,
    priceDriftCooldownMins: 15,
    circuitBreakerDropPct: 5.0,
    circuitBreakerWindowMins: 15,
    fomoCooldownHours: 4.0,
  };

  // Helper para generar velas sintéticas senoidales (mercado oscilante)
  function createSyntheticCandles(length = 2000, basePrice = 60000, amplitude = 2000): CandleBuffer {
    const timestamps = new Float64Array(length);
    const opens = new Float64Array(length);
    const highs = new Float64Array(length);
    const lows = new Float64Array(length);
    const closes = new Float64Array(length);
    const volumes = new Float64Array(length);

    const startTime = Date.now() - (length * 60 * 1000);

    for (let i = 0; i < length; i++) {
      timestamps[i] = startTime + (i * 60 * 1000);
      const price = basePrice + Math.sin(i / 50) * amplitude;
      const variation = Math.sin(i / 5) * 100;

      opens[i] = price;
      highs[i] = price + Math.abs(variation) + 50;
      lows[i] = price - Math.abs(variation) - 50;
      closes[i] = price + variation;
      volumes[i] = 10 + Math.random() * 50;
    }

    return { length, timestamps, opens, highs, lows, closes, volumes };
  }

  it('debe calcular el Fitness Score correctamente penalizando el Drawdown y exceso de inventario', () => {
    const metrics = FitnessCalculator.evaluate(
      2000,   // initialCapital
      2400,   // finalEquity (+20% ROI)
      5.0,    // 5% max drawdown
      120,    // 120 trades
      30000,  // totalVolumeUsd
      22.5,   // feesPaidUsd
      0.005,  // finalBtc (baja tenencia)
      65000,  // finalPrice
      30      // 30 días
    );

    expect(metrics.roiPct).toBe(20);
    expect(metrics.annualizedRoiPct).toBeCloseTo((20 * 365) / 30, 1);
    expect(metrics.fitnessScore).toBeGreaterThan(0);
    expect(metrics.inventoryPenalty).toBe(0);
  });

  it('debe ejecutar una simulación in-memory determinista a ultra-alta velocidad', () => {
    const candles = createSyntheticCandles(3000);
    const t0 = performance.now();
    const result = MemoryEngine.run(candles, sampleParams);
    const t1 = performance.now();

    expect(t1 - t0).toBeLessThan(100); // Debe correr en < 100ms
    expect(result.totalTrades).toBeGreaterThan(0);
    expect(result.finalEquity).toBeGreaterThan(0);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it('debe generar candidatos válidos dentro de los límites en Random Search', () => {
    const sampled = RandomSearchOptimizer.sampleParams(DEFAULT_PARAM_SPACE, 2000);

    expect(sampled.gridLevels).toBeGreaterThanOrEqual(DEFAULT_PARAM_SPACE.gridLevels[0]);
    expect(sampled.gridLevels).toBeLessThanOrEqual(DEFAULT_PARAM_SPACE.gridLevels[1]);
    expect(sampled.atrMultiplier).toBeGreaterThanOrEqual(DEFAULT_PARAM_SPACE.atrMultiplier[0]);
    expect(sampled.atrMultiplier).toBeLessThanOrEqual(DEFAULT_PARAM_SPACE.atrMultiplier[1]);
  });

  it('debe evolucionar y mejorar el Fitness a lo largo de las generaciones en el Algoritmo Genético', () => {
    const candles = createSyntheticCandles(3000);

    const { champions, history } = GeneticOptimizer.run(candles, {
      populationSize: 10,
      generations: 3,
      tournamentSize: 2,
    });

    expect(history.length).toBe(3);
    expect(champions.length).toBeGreaterThan(0);
    expect(champions[0].metrics.fitnessScore).toBeDefined();
  });
});
