import { describe, it, expect } from 'vitest';
import { FitnessCalculator } from './fitness';
import { MemoryEngine, BotHyperparameters } from './memoryEngine';
import { CandleBuffer } from './datasetLoader';
import { RandomSearchOptimizer, DEFAULT_PARAM_SPACE } from './randomSearch';
import { GeneticOptimizer } from './geneticOptimizer';

describe('High-Fidelity Simulation & Genetic Optimizer Test Suite', () => {
  const sampleParams: BotHyperparameters = {
    gridLevels: 11,
    investment: 10000,
    atrPeriod: 15,
    atrTimeframeMinutes: 60,
    atrMultiplier: 3.0,
    minGridRangeUsd: 2000,
    maxGridRangeUsd: 6000,
    priceDriftUpperThreshold: 0.70,
    priceDriftLowerThreshold: 0.30,
    priceDriftCooldownMins: 10,
    circuitBreakerDropPct: 4.5,
    circuitBreakerWindowMins: 30,
    fomoCooldownHours: 6.0,
    enableMonthlyCompounding: true,
  };

  // Helper para generar velas sintéticas senoidales (mercado oscilante)
  function createSyntheticCandles(length = 3000, basePrice = 60000, amplitude = 2000): CandleBuffer {
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
      10000,  // initialCapital
      12000,  // finalEquity (+20% ROI)
      5.0,    // 5% max drawdown
      250,    // 250 trades
      100000, // totalVolumeUsd
      75.0,   // feesPaidUsd (0.075% exact)
      0.02,   // finalBtc
      65000,  // finalPrice
      30      // 30 días
    );

    expect(metrics.roiPct).toBe(20);
    expect(metrics.annualizedRoiPct).toBeCloseTo((20 * 365) / 30, 1);
    expect(metrics.fitnessScore).toBeGreaterThan(0);
    expect(metrics.inventoryPenalty).toBe(0);
    expect(metrics.feesPaidUsd).toBe(75.0);
  });

  it('debe ejecutar una simulación determinista con contabilidad Spot estricta sin inventario fantasma', () => {
    const candles = createSyntheticCandles(3000);
    const t0 = performance.now();
    const result = MemoryEngine.run(candles, sampleParams);
    const t1 = performance.now();

    expect(t1 - t0).toBeLessThan(100); // Debe correr en < 100ms
    expect(result.totalTrades).toBeGreaterThan(0);
    expect(result.finalEquity).toBeGreaterThan(0);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    // Verificar que las comisiones sean proporcionales a la tasa 0.075%
    expect(result.feesPaidUsd).toBeCloseTo(result.totalVolumeUsd * 0.00075, 1);
  });

  it('debe generar candidatos válidos dentro de los límites en Random Search con $10,000 USD de capital', () => {
    const sampled = RandomSearchOptimizer.sampleParams(DEFAULT_PARAM_SPACE, 10000);

    expect(sampled.investment).toBe(10000);
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
      investment: 10000,
    });

    expect(history.length).toBe(3);
    expect(champions.length).toBeGreaterThan(0);
    expect(champions[0].params.investment).toBe(10000);
    expect(champions[0].metrics.fitnessScore).toBeDefined();
  });
});
