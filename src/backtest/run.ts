import 'dotenv/config';
import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { loadEnvConfig, getGridConfigFromEnv } from '../config';
import { GridBacktester, OHLCV } from './backtester';

async function runHistoricalBacktest() {
  console.log('====================================================');
  console.log('📊 Iniciando Fase 1: Backtesting con Datos Históricos');
  console.log('====================================================');

  const env = loadEnvConfig();
  const gridConfig = getGridConfigFromEnv(env);

  // Parámetros de simulación configurables desde entorno (ej: DAYS=30 npm run backtest)
  const daysToFetch = parseInt(process.env.DAYS || '30', 10);
  const timeframe = process.env.TIMEFRAME || '1m';

  console.log(
    `[Config Backtest] Par: ${gridConfig.symbol} | Rango: $${gridConfig.lowerPrice.toFixed(2)} - $${gridConfig.upperPrice.toFixed(2)} | Niveles: ${gridConfig.gridLevels} | Inversión: $${gridConfig.investment.toFixed(2)}`
  );
  console.log(`[Config Simulación] Período: Últimos ${daysToFetch} días | Temporalidad: ${timeframe}`);

  // Inicializar CCXT para descargar velas en modo público (GRATIS)
  const exchange = new ccxt.binance({
    enableRateLimit: true,
  });

  const symbol = gridConfig.symbol;
  const since = Date.now() - daysToFetch * 24 * 60 * 60 * 1000;

  console.log(`[Data Fetch] Descargando velas de ${timeframe} para ${symbol} desde hace ${daysToFetch} días...`);

  const rawCandles: any[] = [];
  let currentSince = since;
  let requestCount = 0;

  try {
    while (currentSince < Date.now()) {
      const fetched = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
      if (!fetched || fetched.length === 0) break;

      rawCandles.push(...fetched);
      requestCount++;

      const lastCandle = fetched[fetched.length - 1];
      if (lastCandle && typeof lastCandle[0] === 'number') {
        // Avance según la temporalidad
        const stepMs = timeframe === '1m' ? 60 * 1000 : timeframe === '5m' ? 5 * 60 * 1000 : 15 * 60 * 1000;
        currentSince = lastCandle[0] + stepMs;
      } else {
        break;
      }

      if (requestCount % 5 === 0) {
        console.log(`[Data Fetch] Descargadas ${rawCandles.length} velas...`);
      }
    }
  } catch (err) {
    console.warn('[Data Fetch Warning] Excepción o límite alcanzado al descargar velas CCXT:', err);
  }

  // Convertir velas a tipos Decimal
  const parsedCandles: OHLCV[] = rawCandles.map((c) => ({
    timestamp: c[0],
    open: new Decimal(c[1]),
    high: new Decimal(c[2]),
    low: new Decimal(c[3]),
    close: new Decimal(c[4]),
    volume: new Decimal(c[5]),
  }));

  if (parsedCandles.length === 0) {
    console.error('[Fatal Error] No se pudieron descargar velas para el backtest.');
    process.exit(1);
  }

  console.log(`[Data Fetch] Complete: Total de ${parsedCandles.length} velas de ${timeframe} cargadas.`);

  // Ejecutar el simulador de grilla
  const backtester = new GridBacktester(gridConfig, 0.05); // 0.05% Maker Fee
  const result = backtester.run(parsedCandles);

  // Presentar reporte de resultados de Backtest
  console.log('\n====================================================');
  console.log('📈 REPORTE DE RESULTADOS DE BACKTESTING HISTÓRICO');
  console.log('====================================================');
  console.log(`⏱️ Período Simulado: ${result.startDate.toISOString().slice(0, 10)} ➔ ${result.endDate.toISOString().slice(0, 10)} (${result.durationHours} horas / ${(result.durationHours / 24).toFixed(1)} días)`);
  console.log(`🕯️ Total Velas Evaluadas (${timeframe}): ${result.totalCandles}`);
  console.log(`🔄 Total FLIPS Completados: ${result.totalFlipsCompleted}`);
  console.log(`📥 Compras Ejecutadas: ${result.totalBuyOrdersFilled}`);
  console.log(`📤 Ventas Ejecutadas: ${result.totalSellOrdersFilled}`);
  console.log('----------------------------------------------------');
  console.log(`💰 Inversión Inicial: $${result.initialInvestmentUsd.toFixed(2)} USD`);
  console.log(`💵 Ganancia Bruta Acumulada: $${result.totalGrossProfitUsd.toFixed(2)} USD`);
  console.log(`💸 Comisiones Simuladas (0.05% Maker): $${result.totalFeesPaidUsd.toFixed(2)} USD`);
  console.log(`📈 BENEFICIO NETO: $${result.netProfitUsd.toFixed(2)} USD (${result.netRoiPercent.toFixed(3)}% ROI)`);
  console.log('----------------------------------------------------');
  console.log(`⚠️ Tiempo Inactivo Fuera de Rango ($${gridConfig.lowerPrice} - $${gridConfig.upperPrice}):`);
  console.log(`   └─ Horas inactivo: ${result.outOfBoundsHours} hrs (${result.outOfBoundsPercent.toFixed(2)}% del tiempo total)`);
  console.log('====================================================\n');
}

runHistoricalBacktest().catch((err) => {
  console.error('[Fatal Error] Error ejecutando backtest:', err);
  process.exit(1);
});
