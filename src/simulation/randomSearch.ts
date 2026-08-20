import { CandleBuffer } from './datasetLoader';
import { BotHyperparameters, MemoryEngine } from './memoryEngine';
import { SimulationMetrics } from './fitness';

export interface ParameterSpace {
  gridLevels: [number, number];
  atrPeriod: [number, number];
  atrMultiplier: [number, number];
  minGridRangeUsd: [number, number];
  maxGridRangeUsd: [number, number];
  priceDriftUpperThreshold: [number, number];
  priceDriftLowerThreshold: [number, number];
  priceDriftCooldownMins: [number, number];
  circuitBreakerDropPct: [number, number];
  circuitBreakerWindowMins: [number, number];
  fomoCooldownHours: [number, number];
}

export const DEFAULT_PARAM_SPACE: ParameterSpace = {
  gridLevels: [10, 30],
  atrPeriod: [7, 28],
  atrMultiplier: [3.0, 10.0],
  minGridRangeUsd: [2000, 5000],
  maxGridRangeUsd: [5000, 12000],
  priceDriftUpperThreshold: [0.70, 0.90],
  priceDriftLowerThreshold: [0.10, 0.30],
  priceDriftCooldownMins: [10, 60],
  circuitBreakerDropPct: [3.0, 8.0],
  circuitBreakerWindowMins: [10, 30],
  fomoCooldownHours: [1.0, 8.0],
};

export interface CandidateEvaluation {
  params: BotHyperparameters;
  metrics: SimulationMetrics;
}

export class RandomSearchOptimizer {
  public static sampleParams(space: ParameterSpace = DEFAULT_PARAM_SPACE, investment = 10000): BotHyperparameters {
    const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randomFloat = (min: number, max: number, decimals = 2) => {
      const val = Math.random() * (max - min) + min;
      return parseFloat(val.toFixed(decimals));
    };

    const minRange = randomFloat(space.minGridRangeUsd[0], space.minGridRangeUsd[1], 0);
    const maxRange = Math.max(minRange + 1000, randomFloat(space.maxGridRangeUsd[0], space.maxGridRangeUsd[1], 0));

    return {
      gridLevels: randomInt(space.gridLevels[0], space.gridLevels[1]),
      investment,
      atrPeriod: randomInt(space.atrPeriod[0], space.atrPeriod[1]),
      atrTimeframeMinutes: 60, // 1h
      atrMultiplier: randomFloat(space.atrMultiplier[0], space.atrMultiplier[1], 1),
      minGridRangeUsd: minRange,
      maxGridRangeUsd: maxRange,
      priceDriftUpperThreshold: randomFloat(space.priceDriftUpperThreshold[0], space.priceDriftUpperThreshold[1], 2),
      priceDriftLowerThreshold: randomFloat(space.priceDriftLowerThreshold[0], space.priceDriftLowerThreshold[1], 2),
      priceDriftCooldownMins: randomInt(space.priceDriftCooldownMins[0], space.priceDriftCooldownMins[1]),
      circuitBreakerDropPct: randomFloat(space.circuitBreakerDropPct[0], space.circuitBreakerDropPct[1], 1),
      circuitBreakerWindowMins: randomInt(space.circuitBreakerWindowMins[0], space.circuitBreakerWindowMins[1]),
      fomoCooldownHours: randomFloat(space.fomoCooldownHours[0], space.fomoCooldownHours[1], 1),
    };
  }

  public static run(
    trainCandles: CandleBuffer,
    iterations = 500,
    space: ParameterSpace = DEFAULT_PARAM_SPACE,
    investment = 10000,
    onProgress?: (completed: number, total: number, best: CandidateEvaluation | null) => void
  ): CandidateEvaluation[] {
    const results: CandidateEvaluation[] = [];
    let best: CandidateEvaluation | null = null;

    for (let i = 0; i < iterations; i++) {
      const candidate = this.sampleParams(space, investment);
      const metrics = MemoryEngine.run(trainCandles, candidate);
      const evaluation: CandidateEvaluation = { params: candidate, metrics };
      results.push(evaluation);

      if (!best || metrics.fitnessScore > best.metrics.fitnessScore) {
        best = evaluation;
      }

      if (onProgress && (i % 25 === 0 || i === iterations - 1)) {
        onProgress(i + 1, iterations, best);
      }
    }

    // Ordenar de mejor a peor según fitnessScore descendente
    results.sort((a, b) => b.metrics.fitnessScore - a.metrics.fitnessScore);
    return results;
  }
}
