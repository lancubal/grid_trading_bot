import { CandleBuffer } from './datasetLoader';
import { BotHyperparameters, MemoryEngine } from './memoryEngine';
import { SimulationMetrics } from './fitness';
import { ParallelEvaluator } from './parallelRunner';

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
  takeProfitMultiplier: [number, number];
  buyCapitalWeight: [number, number];
  microCapitalRatio: [number, number];
  microGridRangeUsd: [number, number];
  microGridLevels: [number, number];
  regimeThresholdPct: [number, number];
}

export const DEFAULT_PARAM_SPACE: ParameterSpace = {
  gridLevels: [8, 18],
  atrPeriod: [7, 28],
  atrMultiplier: [2.0, 6.0],
  minGridRangeUsd: [3000, 7000],
  maxGridRangeUsd: [6000, 15000],
  priceDriftUpperThreshold: [0.65, 0.90],
  priceDriftLowerThreshold: [0.10, 0.35],
  priceDriftCooldownMins: [15, 60],
  circuitBreakerDropPct: [3.5, 7.5],
  circuitBreakerWindowMins: [15, 45],
  fomoCooldownHours: [3.0, 12.0],
  takeProfitMultiplier: [1.0, 2.2],
  buyCapitalWeight: [0.50, 0.70],
  microCapitalRatio: [0.20, 0.45],
  microGridRangeUsd: [1000, 2500],
  microGridLevels: [5, 9],
  regimeThresholdPct: [0.8, 2.5],
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
      takeProfitMultiplier: randomFloat(space.takeProfitMultiplier[0], space.takeProfitMultiplier[1], 1),
      buyCapitalWeight: randomFloat(space.buyCapitalWeight[0], space.buyCapitalWeight[1], 2),
      enableContinuousCompounding: true,
      enableDualLayer: true,
      microCapitalRatio: randomFloat(space.microCapitalRatio[0], space.microCapitalRatio[1], 2),
      microGridRangeUsd: randomFloat(space.microGridRangeUsd[0], space.microGridRangeUsd[1], 0),
      microGridLevels: randomInt(space.microGridLevels[0], space.microGridLevels[1]),
      enableRegimeOrchestrator: true,
      regimeThresholdPct: randomFloat(space.regimeThresholdPct[0], space.regimeThresholdPct[1], 2),
    };
  }

  public static async runParallel(
    trainCandles: CandleBuffer,
    iterations = 500,
    space: ParameterSpace = DEFAULT_PARAM_SPACE,
    investment = 10000,
    onProgress?: (completed: number, total: number, best: CandidateEvaluation | null) => void
  ): Promise<CandidateEvaluation[]> {
    const candidates: BotHyperparameters[] = [];
    for (let i = 0; i < iterations; i++) {
      candidates.push(this.sampleParams(space, investment));
    }

    const results = await ParallelEvaluator.evaluateBatch(trainCandles, candidates, (completed, total) => {
      if (onProgress) {
        onProgress(completed, total, null);
      }
    });

    results.sort((a, b) => b.metrics.fitnessScore - a.metrics.fitnessScore);
    return results;
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

    results.sort((a, b) => b.metrics.fitnessScore - a.metrics.fitnessScore);
    return results;
  }
}
