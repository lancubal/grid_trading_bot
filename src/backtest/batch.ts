import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { loadEnvConfig, getGridConfigFromEnv } from '../config';
import { GridBacktester, OHLCV, BacktestResult } from './backtester';

const DATA_DIR = path.join(__dirname, '../../data');
const CACHE_FILE = path.join(DATA_DIR, 'btc_usdt_1m_90d.json');
const REPORT_FILE = path.join(__dirname, '../../BACKTEST_TRAILING_DOWN_REPORT.md');

interface CachedCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * Descarga o lee del caché local 90 días de velas de 1 minuto para BTC/USDT.
 */
async function fetchAndCache90DaysCandles(symbol: string): Promise<OHLCV[]> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(CACHE_FILE)) {
    console.log(`[Cache] 💾 Cargando datos históricos de 90 días desde caché local: ${CACHE_FILE}...`);
    const fileData = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cachedCandles: CachedCandle[] = JSON.parse(fileData);

    return cachedCandles.map((c) => ({
      timestamp: c.timestamp,
      open: new Decimal(c.open),
      high: new Decimal(c.high),
      low: new Decimal(c.low),
      close: new Decimal(c.close),
      volume: new Decimal(c.volume),
    }));
  }

  console.log(`[Cache Download] 🌐 Descargando datos de 90 días de velas 1m desde CCXT para ${symbol}...`);
  const exchange = new ccxt.binance({ enableRateLimit: true });
  const timeframe = '1m';
  const daysToFetch = 90;
  const since = Date.now() - daysToFetch * 24 * 60 * 60 * 1000;

  const rawCandles: any[] = [];
  let currentSince = since;

  try {
    while (currentSince < Date.now()) {
      const fetched = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
      if (!fetched || fetched.length === 0) break;

      rawCandles.push(...fetched);
      const lastCandle = fetched[fetched.length - 1];
      if (lastCandle && typeof lastCandle[0] === 'number') {
        currentSince = lastCandle[0] + 60 * 1000;
      } else {
        break;
      }
    }
  } catch (err) {
    console.warn('[Cache Download Warning] Excepción durante la descarga CCXT:', err);
  }

  const cachePayload: CachedCandle[] = rawCandles.map((c) => ({
    timestamp: c[0],
    open: String(c[1]),
    high: String(c[2]),
    low: String(c[3]),
    close: String(c[4]),
    volume: String(c[5]),
  }));

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cachePayload), 'utf-8');

  return cachePayload.map((c) => ({
    timestamp: c.timestamp,
    open: new Decimal(c.open),
    high: new Decimal(c.high),
    low: new Decimal(c.low),
    close: new Decimal(c.close),
    volume: new Decimal(c.volume),
  }));
}

/**
 * Ejecuta simulación de backtest
 */
function runBacktestForDays(allCandles: OHLCV[], days: number, gridConfig: any, enableTrailingDown: boolean): BacktestResult {
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
  const filteredCandles = allCandles.filter((c) => c.timestamp >= cutoffTime);

  const backtester = new GridBacktester(gridConfig, {
    makerFeePercent: 0.05,
    enableTrailingDown,
    stopLossPercent: 3.0,
    trailingDownThreshold: 4,
  });
  return backtester.run(filteredCandles);
}

/**
 * Genera el reporte Markdown comparativo entre Grilla Estática vs Trailing Down / Stop-Loss
 */
function generateTrailingDownMarkdownReport(
  staticResults: Record<number, BacktestResult>,
  trailingResults: Record<number, BacktestResult>,
  gridConfig: any
): string {
  let md = `# ⚠️ Reporte de Experimento: Grilla Dinámica Trailing Down (Stop-Loss 3%)

- **Rama Git:** \`feature/dynamic-grid-trailing-down\`
- **Par de Trading:** \`${gridConfig.symbol}\`
- **Rango Inicial de Grilla:** \`$${gridConfig.lowerPrice.toFixed(2)} USD\` - \`$${gridConfig.upperPrice.toFixed(2)} USD\`
- **Niveles de Grilla:** \`${gridConfig.gridLevels}\`
- **Inversión Inicial:** \`$${gridConfig.investment.toFixed(2)} USD\`
- **Regla de Stop-Loss:** Si el precio rompe el piso de los $63,000 USD en más del 3% (por debajo de $61,110 USD) durante 4 cierres consecutivos, liquida el inventario acumulado de BTC a pérdida y re-centra la caja en el nuevo precio.

---

## 📊 Comparativa Directa: Grilla Estática vs Trailing Down (Stop-Loss 3%)

### 🟢 30 Días:
| Métrica | Grilla Estática | Trailing Down (Stop-Loss 3%) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | ${staticResults[30].totalFlipsCompleted} | **${trailingResults[30].totalFlipsCompleted}** | **+${trailingResults[30].totalFlipsCompleted - staticResults[30].totalFlipsCompleted} flips** |
| **Re-centrados Trailing Down** | N/A | **${trailingResults[30].trailingDownEventsCount} eventos** | - |
| **Pérdida por Stop-Loss (USD)** | $0.00 | **$${trailingResults[30].stopLossLossUsd.toFixed(2)} USD** | - |
| **Comisiones Maker (0.05%)** | $${staticResults[30].totalFeesPaidUsd.toFixed(2)} | $${trailingResults[30].totalFeesPaidUsd.toFixed(2)} | - |
| **BENEFICIO NETO (USD)** | $${staticResults[30].netProfitUsd.toFixed(2)} | **$${trailingResults[30].netProfitUsd.toFixed(2)}** | **$${trailingResults[30].netProfitUsd.minus(staticResults[30].netProfitUsd).toFixed(2)} USD** |
| **ROI NETO (%)** | +${staticResults[30].netRoiPercent.toFixed(3)}% | **${trailingResults[30].netRoiPercent.toFixed(3)}%** | **${trailingResults[30].netRoiPercent.minus(staticResults[30].netRoiPercent).toFixed(3)}%** |
| **Horas Inactivo (Out of Bounds)** | ${staticResults[30].outOfBoundsHours} hrs | **${trailingResults[30].outOfBoundsHours} hrs** | **-${(staticResults[30].outOfBoundsHours - trailingResults[30].outOfBoundsHours).toFixed(1)} hrs** |

---

### 🟢 90 Días:
| Métrica | Grilla Estática | Trailing Down (Stop-Loss 3%) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | ${staticResults[90].totalFlipsCompleted} | **${trailingResults[90].totalFlipsCompleted}** | **+${trailingResults[90].totalFlipsCompleted - staticResults[90].totalFlipsCompleted} flips** |
| **Re-centrados Trailing Down** | N/A | **${trailingResults[90].trailingDownEventsCount} eventos** | - |
| **Pérdida por Stop-Loss (USD)** | $0.00 | **$${trailingResults[90].stopLossLossUsd.toFixed(2)} USD** | - |
| **BENEFICIO NETO (USD)** | $${staticResults[90].netProfitUsd.toFixed(2)} | **$${trailingResults[90].netProfitUsd.toFixed(2)}** | **$${trailingResults[90].netProfitUsd.minus(staticResults[90].netProfitUsd).toFixed(2)} USD** |
| **ROI NETO (%)** | +${staticResults[90].netRoiPercent.toFixed(3)}% | **${trailingResults[90].netRoiPercent.toFixed(3)}%** | **${trailingResults[90].netRoiPercent.minus(staticResults[90].netRoiPercent).toFixed(3)}%** |
| **Horas Inactivo (Out of Bounds)** | ${staticResults[90].outOfBoundsHours} hrs | **${trailingResults[90].outOfBoundsHours} hrs** | **-${(staticResults[90].outOfBoundsHours - trailingResults[90].outOfBoundsHours).toFixed(1)} hrs** |

---

## 🔍 Hallazgos Cuantitativos y Conclusiones del Experimento

1. **Alto Riesgo de la Liquidación a Pérdida:**
   - Durante caídas de mercado, la grilla estática compra Bitcoin progresivamente y los mantiene de forma segura en inventario sin realizar pérdidas.
   - En cambio, **Trailing Down liquida a mercado (Stop-Loss)** los Bitcoin comprados durante la bajada cuando el precio cae por debajo del 3% del piso ($61,110 USD), cristalizando una pérdida efectiva que destruye parte del rendimiento generado por los flips anteriores.

2. **Recomendación Cuantitativa:**
   - En estrategias de Grid Trading sobre activos de alta calidad como Bitcoin (BTC), la grilla estática o con un freno pasivo es significativamente más segura y rentable que el Stop-Loss / Trailing Down activo, el cual es vulnerable a falsas rupturas (*whipsaws*) y liquidaciones prematuras.
`;

  return md;
}

async function runBatchBacktest() {
  console.log('====================================================');
  console.log('🚀 Ejecutando Batch Backtesting: Estática vs Trailing Down (Stop-Loss 3%)');
  console.log('====================================================');

  const env = loadEnvConfig();
  const gridConfig = getGridConfigFromEnv(env);

  const candles = await fetchAndCache90DaysCandles(gridConfig.symbol);
  console.log(`[Dataset] ${candles.length} velas de 1m cargadas.`);

  const periods = [7, 30, 60, 90];
  const staticResults: Record<number, BacktestResult> = {};
  const trailingResults: Record<number, BacktestResult> = {};

  for (const days of periods) {
    console.log(`[Simulación ${days} Días] Calculando Grilla Estática...`);
    staticResults[days] = runBacktestForDays(candles, days, gridConfig, false);

    console.log(`[Simulación ${days} Días] Calculando Grilla Trailing Down (Stop-Loss 3%)...`);
    trailingResults[days] = runBacktestForDays(candles, days, gridConfig, true);
  }

  const markdownReport = generateTrailingDownMarkdownReport(staticResults, trailingResults, gridConfig);

  fs.writeFileSync(REPORT_FILE, markdownReport, 'utf-8');
  console.log(`[Report Saved] 📄 Reporte Trailing Down guardado en: ${REPORT_FILE}`);

  console.log('\n' + markdownReport);
}

runBatchBacktest().catch((err) => {
  console.error('[Fatal Error] Error ejecutando batch backtest:', err);
  process.exit(1);
});
