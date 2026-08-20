import path from 'path';
import fs from 'fs';
import os from 'os';
import { DatasetLoader } from './datasetLoader';
import { RandomSearchOptimizer } from './randomSearch';
import { GeneticOptimizer } from './geneticOptimizer';
import { MemoryEngine } from './memoryEngine';

async function main() {
  const cpus = os.cpus();
  console.log('================================================================');
  console.log('🧬 OPTIMIZADOR EVOLUTIVO DE ALTA FIDELIDAD (BTC/USDT SPOT)');
  console.log('================================================================');
  console.log(`• Hardware Detectado: ${cpus[0]?.model || 'CPU'} (${cpus.length} cores)`);
  console.log(`• Capital Inicial: $10,000.00 USD (Spot 50% USDT / 50% BTC)`);
  console.log(`• Reinversión: Mensual (Compounding de beneficios al cierre de mes)`);
  console.log(`• Comisiones: 0.075% BNB Spot exacta por orden ejecutada`);
  console.log(`• Contabilidad: Spot Estricta (Cero inventario fantasma)`);

  const datasetPath = path.resolve(__dirname, '../../datasets/btc_historical_1m.csv');

  if (!fs.existsSync(datasetPath)) {
    console.error(`\n❌ Error: No se encontró el dataset histórico en: ${datasetPath}`);
    console.log(`👉 Por favor ejecuta primero: npm run download-data\n`);
    process.exit(1);
  }

  const startTime = Date.now();
  const INITIAL_INVESTMENT = 10000;

  // 1. Cargar y particionar dataset
  const dataset = await DatasetLoader.load(datasetPath, 0.70);

  // 2. FASE 1: Random Search (Exploración Monte Carlo)
  console.log('----------------------------------------------------------------');
  console.log('🔍 FASE 1: RANDOM SEARCH (Exploración Global del Espacio de Parámetros)');
  console.log('----------------------------------------------------------------');
  const RANDOM_ITERATIONS = 300;
  console.log(`• Evaluando ${RANDOM_ITERATIONS} configuraciones sobre Train Set (70%)...`);

  const t0 = Date.now();
  const randomResults = RandomSearchOptimizer.run(
    dataset.train,
    RANDOM_ITERATIONS,
    undefined,
    INITIAL_INVESTMENT,
    (completed, total, best) => {
      process.stdout.write(
        `\r⏳ Progreso: ${completed}/${total} (${((completed / total) * 100).toFixed(0)}%) | Mejor Fitness: ${best?.metrics.fitnessScore.toFixed(2)} (ROI: ${best?.metrics.roiPct.toFixed(1)}% | MaxDD: ${best?.metrics.maxDrawdownPct.toFixed(1)}% | Trades: ${best?.metrics.totalTrades})`
      );
    }
  );
  console.log(`\n✅ Fase 1 completada en ${((Date.now() - t0) / 1000).toFixed(2)}s.`);
  console.log(`🏆 Mejor Candidato Fase 1: Fitness ${randomResults[0].metrics.fitnessScore.toFixed(2)} | ROI ${randomResults[0].metrics.roiPct.toFixed(2)}% | Ganancia Neta: $${randomResults[0].metrics.netProfitUsd.toFixed(2)} USD\n`);

  // 3. FASE 2: Algoritmo Genético (Evolución Fina)
  console.log('----------------------------------------------------------------');
  console.log('🧬 FASE 2: ALGORITMO GENÉTICO (Evolución, Cruce y Mutación)');
  console.log('----------------------------------------------------------------');
  const POPULATION_SIZE = 40;
  const GENERATIONS = 15;
  console.log(`• Población: ${POPULATION_SIZE} individuos | Generaciones: ${GENERATIONS}`);
  console.log(`• Sembrando Generación 0 con los mejores ${POPULATION_SIZE} candidatos de Fase 1...`);

  const topSeeds = randomResults.slice(0, POPULATION_SIZE).map((r) => r.params);

  const t1 = Date.now();
  const geneticResults = GeneticOptimizer.run(
    dataset.train,
    {
      populationSize: POPULATION_SIZE,
      generations: GENERATIONS,
      seedPopulation: topSeeds,
      investment: INITIAL_INVESTMENT,
    },
    (summary) => {
      console.log(
        `🌱 Gen ${summary.generationIndex.toString().padStart(2, '0')}/${GENERATIONS} | Mejor Fitness: ${summary.bestFitness.toFixed(2)} | Promedio: ${summary.avgFitness.toFixed(2)} | ROI: ${summary.bestIndividual.metrics.roiPct.toFixed(2)}% | MaxDD: ${summary.bestIndividual.metrics.maxDrawdownPct.toFixed(1)}% | Trades: ${summary.bestIndividual.metrics.totalTrades}`
      );
    }
  );
  console.log(`✅ Fase 2 completada en ${((Date.now() - t1) / 1000).toFixed(2)}s.\n`);

  // 4. FASE 3: Validación Cruzada Ciega Out-of-Sample (Test 30%)
  console.log('================================================================');
  console.log('🛡️ FASE 3: VALIDACIÓN CRUZADA OUT-OF-SAMPLE (Prueba Ciega en Test Set)');
  console.log('================================================================');
  console.log(`• Evaluando los mejores 3 campeones en datos NO VISTOS (${dataset.test.length.toLocaleString()} velas de 1m)...`);

  const topChampions = geneticResults.champions.slice(0, 3);

  topChampions.forEach((champion, idx) => {
    const testMetrics = MemoryEngine.run(dataset.test, champion.params);
    const trainMetrics = champion.metrics;

    console.log(`\n----------------------------------------------------------------`);
    console.log(`👑 CAMPEÓN #${idx + 1}`);
    console.log(`----------------------------------------------------------------`);
    console.log(`📊 COMPARATIVA TRAIN (70%) vs TEST (30% Ciego):`);
    console.log(`• Fitness Score:        Train: ${trainMetrics.fitnessScore.toFixed(2).padStart(8)}  ➔  Test: ${testMetrics.fitnessScore.toFixed(2).padStart(8)}`);
    console.log(`• Capital Inicial:      $${INITIAL_INVESTMENT.toLocaleString()} USD`);
    console.log(`• Patrimonio Final:     Train: $${trainMetrics.finalEquity.toFixed(2).padStart(9)}  ➔  Test: $${testMetrics.finalEquity.toFixed(2).padStart(9)}`);
    console.log(`• Ganancia Neta USD:    Train: $${trainMetrics.netProfitUsd.toFixed(2).padStart(9)}  ➔  Test: $${testMetrics.netProfitUsd.toFixed(2).padStart(9)}`);
    console.log(`• ROI Total:            Train: ${trainMetrics.roiPct.toFixed(2).padStart(7)}%  ➔  Test: ${testMetrics.roiPct.toFixed(2).padStart(7)}%`);
    console.log(`• ROI Anualizado:       Train: ${trainMetrics.annualizedRoiPct.toFixed(2).padStart(7)}%  ➔  Test: ${testMetrics.annualizedRoiPct.toFixed(2).padStart(7)}%`);
    console.log(`• Max Drawdown:         Train: ${trainMetrics.maxDrawdownPct.toFixed(2).padStart(7)}%  ➔  Test: ${testMetrics.maxDrawdownPct.toFixed(2).padStart(7)}%`);
    console.log(`• Trades Ejecutados:    Train: ${trainMetrics.totalTrades.toString().padStart(8)}  ➔  Test: ${testMetrics.totalTrades.toString().padStart(8)}`);
    console.log(`• Volumen Operado:      Train: $${trainMetrics.totalVolumeUsd.toFixed(2).padStart(9)}  ➔  Test: $${testMetrics.totalVolumeUsd.toFixed(2).padStart(9)}`);
    console.log(`• Comisiones BNB Pagas: Train: $${trainMetrics.feesPaidUsd.toFixed(2).padStart(8)}  ➔  Test: $${testMetrics.feesPaidUsd.toFixed(2).padStart(8)}`);
    console.log(`• Tenencia Final BTC:   Train: ${trainMetrics.holdingBtcFinal.toFixed(4)} BTC  ➔  Test: ${testMetrics.holdingBtcFinal.toFixed(4)} BTC ($${trainMetrics.holdingBtcValueUsd.toFixed(2)})`);

    console.log(`\n⚙️ CONFIGURACIÓN .ENV RECOMENDADA:`);
    console.log(`GRID_LEVELS="${champion.params.gridLevels}"`);
    console.log(`ATR_PERIOD="${champion.params.atrPeriod}"`);
    console.log(`ATR_MULTIPLIER="${champion.params.atrMultiplier}"`);
    console.log(`MIN_GRID_RANGE_USD="${champion.params.minGridRangeUsd}.00"`);
    console.log(`MAX_GRID_RANGE_USD="${champion.params.maxGridRangeUsd}.00"`);
    console.log(`PRICE_DRIFT_UPPER_THRESHOLD="${champion.params.priceDriftUpperThreshold}"`);
    console.log(`PRICE_DRIFT_LOWER_THRESHOLD="${champion.params.priceDriftLowerThreshold}"`);
    console.log(`PRICE_DRIFT_COOLDOWN_MINS="${champion.params.priceDriftCooldownMins}"`);
    console.log(`CIRCUIT_BREAKER_DROP_PCT="${champion.params.circuitBreakerDropPct}"`);
    console.log(`CIRCUIT_BREAKER_WINDOW_MINS="${champion.params.circuitBreakerWindowMins}"`);
    console.log(`FOMO_COOLDOWN_HOURS="${champion.params.fomoCooldownHours}"`);
  });

  console.log(`\n================================================================`);
  console.log(`✨ OPTIMIZACIÓN FINALIZADA EN ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  console.log(`================================================================\n`);
}

main().catch((err) => {
  console.error('❌ Error en ejecución del optimizador:', err);
  process.exit(1);
});
