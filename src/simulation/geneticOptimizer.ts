import { CandleBuffer } from './datasetLoader';
import { BotHyperparameters, MemoryEngine } from './memoryEngine';
import { CandidateEvaluation, DEFAULT_PARAM_SPACE, ParameterSpace, RandomSearchOptimizer } from './randomSearch';

export interface GeneticOptimizerOptions {
  populationSize?: number;
  generations?: number;
  tournamentSize?: number;
  crossoverRate?: number;
  mutationRate?: number;
  elitismCount?: number;
  space?: ParameterSpace;
  investment?: number;
  seedPopulation?: BotHyperparameters[];
}

export interface GenerationSummary {
  generationIndex: number;
  bestFitness: number;
  avgFitness: number;
  bestIndividual: CandidateEvaluation;
}

export class GeneticOptimizer {
  private static clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  private static crossover(
    parentA: BotHyperparameters,
    parentB: BotHyperparameters,
    space: ParameterSpace
  ): BotHyperparameters {
    const pick = (geneA: number, geneB: number) => (Math.random() < 0.5 ? geneA : geneB);
    const blend = (geneA: number, geneB: number, alpha = 0.5) => {
      const min = Math.min(geneA, geneB);
      const max = Math.max(geneA, geneB);
      const range = max - min;
      return min + (Math.random() * (range + 2 * alpha * range) - alpha * range);
    };

    const minRange = this.clamp(blend(parentA.minGridRangeUsd, parentB.minGridRangeUsd), space.minGridRangeUsd[0], space.minGridRangeUsd[1]);
    const maxRange = this.clamp(blend(parentA.maxGridRangeUsd, parentB.maxGridRangeUsd), Math.max(minRange + 1000, space.maxGridRangeUsd[0]), space.maxGridRangeUsd[1]);

    return {
      gridLevels: Math.round(this.clamp(pick(parentA.gridLevels, parentB.gridLevels), space.gridLevels[0], space.gridLevels[1])),
      investment: parentA.investment,
      atrPeriod: Math.round(this.clamp(pick(parentA.atrPeriod, parentB.atrPeriod), space.atrPeriod[0], space.atrPeriod[1])),
      atrTimeframeMinutes: 60,
      atrMultiplier: parseFloat(this.clamp(blend(parentA.atrMultiplier, parentB.atrMultiplier), space.atrMultiplier[0], space.atrMultiplier[1]).toFixed(1)),
      minGridRangeUsd: Math.round(minRange),
      maxGridRangeUsd: Math.round(maxRange),
      priceDriftUpperThreshold: parseFloat(this.clamp(blend(parentA.priceDriftUpperThreshold, parentB.priceDriftUpperThreshold), space.priceDriftUpperThreshold[0], space.priceDriftUpperThreshold[1]).toFixed(2)),
      priceDriftLowerThreshold: parseFloat(this.clamp(blend(parentA.priceDriftLowerThreshold, parentB.priceDriftLowerThreshold), space.priceDriftLowerThreshold[0], space.priceDriftLowerThreshold[1]).toFixed(2)),
      priceDriftCooldownMins: Math.round(this.clamp(blend(parentA.priceDriftCooldownMins, parentB.priceDriftCooldownMins), space.priceDriftCooldownMins[0], space.priceDriftCooldownMins[1])),
      circuitBreakerDropPct: parseFloat(this.clamp(blend(parentA.circuitBreakerDropPct, parentB.circuitBreakerDropPct), space.circuitBreakerDropPct[0], space.circuitBreakerDropPct[1]).toFixed(1)),
      circuitBreakerWindowMins: Math.round(this.clamp(blend(parentA.circuitBreakerWindowMins, parentB.circuitBreakerWindowMins), space.circuitBreakerWindowMins[0], space.circuitBreakerWindowMins[1])),
      fomoCooldownHours: parseFloat(this.clamp(blend(parentA.fomoCooldownHours, parentB.fomoCooldownHours), space.fomoCooldownHours[0], space.fomoCooldownHours[1]).toFixed(1)),
    };
  }

  private static mutate(
    individual: BotHyperparameters,
    mutationRate: number,
    space: ParameterSpace
  ): BotHyperparameters {
    const mutated = { ...individual };
    const mutateGene = (val: number, min: number, max: number, stepPct = 0.10) => {
      if (Math.random() < mutationRate) {
        const delta = (max - min) * stepPct * (Math.random() * 2 - 1);
        return this.clamp(val + delta, min, max);
      }
      return val;
    };

    mutated.gridLevels = Math.round(mutateGene(mutated.gridLevels, space.gridLevels[0], space.gridLevels[1]));
    mutated.atrPeriod = Math.round(mutateGene(mutated.atrPeriod, space.atrPeriod[0], space.atrPeriod[1]));
    mutated.atrMultiplier = parseFloat(mutateGene(mutated.atrMultiplier, space.atrMultiplier[0], space.atrMultiplier[1]).toFixed(1));
    mutated.minGridRangeUsd = Math.round(mutateGene(mutated.minGridRangeUsd, space.minGridRangeUsd[0], space.minGridRangeUsd[1]));
    mutated.maxGridRangeUsd = Math.round(mutateGene(mutated.maxGridRangeUsd, Math.max(mutated.minGridRangeUsd + 1000, space.maxGridRangeUsd[0]), space.maxGridRangeUsd[1]));
    mutated.priceDriftUpperThreshold = parseFloat(mutateGene(mutated.priceDriftUpperThreshold, space.priceDriftUpperThreshold[0], space.priceDriftUpperThreshold[1]).toFixed(2));
    mutated.priceDriftLowerThreshold = parseFloat(mutateGene(mutated.priceDriftLowerThreshold, space.priceDriftLowerThreshold[0], space.priceDriftLowerThreshold[1]).toFixed(2));
    mutated.priceDriftCooldownMins = Math.round(mutateGene(mutated.priceDriftCooldownMins, space.priceDriftCooldownMins[0], space.priceDriftCooldownMins[1]));
    mutated.circuitBreakerDropPct = parseFloat(mutateGene(mutated.circuitBreakerDropPct, space.circuitBreakerDropPct[0], space.circuitBreakerDropPct[1]).toFixed(1));
    mutated.circuitBreakerWindowMins = Math.round(mutateGene(mutated.circuitBreakerWindowMins, space.circuitBreakerWindowMins[0], space.circuitBreakerWindowMins[1]));
    mutated.fomoCooldownHours = parseFloat(mutateGene(mutated.fomoCooldownHours, space.fomoCooldownHours[0], space.fomoCooldownHours[1]).toFixed(1));

    return mutated;
  }

  private static tournamentSelect(evaluations: CandidateEvaluation[], tournamentSize: number): CandidateEvaluation {
    let best: CandidateEvaluation | null = null;
    for (let i = 0; i < tournamentSize; i++) {
      const randomIdx = Math.floor(Math.random() * evaluations.length);
      const contestant = evaluations[randomIdx];
      if (!best || contestant.metrics.fitnessScore > best.metrics.fitnessScore) {
        best = contestant;
      }
    }
    return best!;
  }

  public static run(
    trainCandles: CandleBuffer,
    options: GeneticOptimizerOptions = {},
    onGenerationProgress?: (summary: GenerationSummary) => void
  ): { champions: CandidateEvaluation[]; history: GenerationSummary[] } {
    const popSize = options.populationSize || 50;
    const maxGen = options.generations || 20;
    const tourSize = options.tournamentSize || 3;
    const crossRate = options.crossoverRate || 0.85;
    const mutRate = options.mutationRate || 0.20;
    const elitism = options.elitismCount || 2;
    const space = options.space || DEFAULT_PARAM_SPACE;
    const investment = options.investment || 2000;

    // 1. Inicialización de la Población (Generación 0)
    let population: BotHyperparameters[] = [];
    if (options.seedPopulation && options.seedPopulation.length > 0) {
      population.push(...options.seedPopulation.slice(0, popSize));
    }
    while (population.length < popSize) {
      population.push(RandomSearchOptimizer.sampleParams(space, investment));
    }

    const history: GenerationSummary[] = [];

    // 2. Bucle Evolutivo
    for (let gen = 0; gen < maxGen; gen++) {
      // Evaluar población
      const evaluations: CandidateEvaluation[] = population.map((individual) => {
        const metrics = MemoryEngine.run(trainCandles, individual);
        return { params: individual, metrics };
      });

      // Ordenar por fitness descendente
      evaluations.sort((a, b) => b.metrics.fitnessScore - a.metrics.fitnessScore);

      const bestInd = evaluations[0];
      const sumFitness = evaluations.reduce((acc, curr) => acc + curr.metrics.fitnessScore, 0);
      const avgFitness = sumFitness / evaluations.length;

      const summary: GenerationSummary = {
        generationIndex: gen + 1,
        bestFitness: bestInd.metrics.fitnessScore,
        avgFitness,
        bestIndividual: bestInd,
      };
      history.push(summary);

      if (onGenerationProgress) {
        onGenerationProgress(summary);
      }

      // Si es la última generación, finalizar
      if (gen === maxGen - 1) break;

      // 3. Crear Nueva Generación
      const newPopulation: BotHyperparameters[] = [];

      // Elitismo: Preservar los mejores N individuos
      for (let e = 0; e < elitism; e++) {
        newPopulation.push(evaluations[e].params);
      }

      // Reproducción, Cruce y Mutación
      while (newPopulation.length < popSize) {
        const parentA = this.tournamentSelect(evaluations, tourSize).params;
        const parentB = this.tournamentSelect(evaluations, tourSize).params;

        let offspring = Math.random() < crossRate ? this.crossover(parentA, parentB, space) : { ...parentA };
        offspring = this.mutate(offspring, mutRate, space);
        newPopulation.push(offspring);
      }

      population = newPopulation;
    }

    // Retornar top 5 campeones
    const finalEvaluations = population.map((ind) => ({
      params: ind,
      metrics: MemoryEngine.run(trainCandles, ind),
    }));
    finalEvaluations.sort((a, b) => b.metrics.fitnessScore - a.metrics.fitnessScore);

    return {
      champions: finalEvaluations.slice(0, 5),
      history,
    };
  }
}
