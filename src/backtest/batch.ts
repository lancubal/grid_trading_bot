import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import { loadEnvConfig, getGridConfigFromEnv } from '../config';
import { GridBacktester, OHLCV, BacktestResult } from './backtester';

const DATA_DIR = path.join(__dirname, '../../data');
const CACHE_FILE = path.join(DATA_DIR, 'btc_usdt_1m_90d.json');
const REPORT_FILE = path.join(__dirname, '../../BACKTEST_TRAILING_UP_REPORT.md');

interface CachedCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * Descarga y almacena en caché 90 días de velas de 1 minuto para BTC/USDT de forma eficiente.
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
  let requestCount = 0;

  try {
    while (currentSince < Date.now()) {
      const fetched = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
      if (!fetched || fetched.length === 0) break;

      rawCandles.push(...fetched);
      requestCount++;

      const lastCandle = fetched[fetched.length - 1];
      if (lastCandle && typeof lastCandle[0] === 'number') {
        currentSince = lastCandle[0] + 60 * 1000;
      } else {
        break;
      }

      if (requestCount % 10 === 0) {
        console.log(`[Cache Download] Descargadas ${rawCandles.length} / ~129,600 velas de 1m...`);
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
function runBacktestForDays(allCandles: OHLCV[], days: number, gridConfig: any, enableTrailingUp: boolean): BacktestResult {
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
  const filteredCandles = allCandles.filter((c) => c.timestamp >= cutoffTime);

  const backtester = new GridBacktester(gridConfig, {
    makerFeePercent: 0.05,
    enableTrailingUp,
    trailingUpThreshold: 4,
  });
  return backtester.run(filteredCandles);
}

/**
 * Genera el reporte Markdown comparativo entre Grilla Estática vs Trailing Up
 */
function generateTrailingUpMarkdownReport(
  staticResults: Record<number, BacktestResult>,
  trailingResults: Record<number, BacktestResult>,
  gridConfig: any
): string {
  let md = `# 🚀 Reporte de Experimento: Grilla Dinámica Trailing Up (Re-centrado hacia arriba)

- **Rama Git:** \`feature/dynamic-grid-trailing-up\`
- **Par de Trading:** \`${gridConfig.symbol}\`
- **Rango Inicial de Grilla:** \`$${gridConfig.lowerPrice.toFixed(2)} USD\` - \`$${gridConfig.upperPrice.toFixed(2)} USD\`
- **Niveles de Grilla:** \`${gridConfig.gridLevels}\`
- **Inversión Inicial:** \`$${gridConfig.investment.toFixed(2)} USD\`
- **Regla de Trailing Up:** Al cerrar 4 velas consecutivas por encima del techo, cancela ventas (100% liquidez en USDT) y re-centra la caja de $3,000 USD en el nuevo precio.

---

## 📊 Comparativa Directa: Grilla Estática vs Grilla Dinámica Trailing Up

### 🟢 30 Días:
| Métrica | Grilla Estática | Trailing Up (Dinámica) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | ${staticResults[30].totalFlipsCompleted} | **${trailingResults[30].totalFlipsCompleted}** | **+${trailingResults[30].totalFlipsCompleted - staticResults[30].totalFlipsCompleted} flips** |
| **Re-centrados Trailing Up** | N/A | **${trailingResults[30].trailingUpEventsCount} eventos** | - |
| **Comisiones Maker (0.05%)** | $${staticResults[30].totalFeesPaidUsd.toFixed(2)} | $${trailingResults[30].totalFeesPaidUsd.toFixed(2)} | - |
| **BENEFICIO NETO (USD)** | $${staticResults[30].netProfitUsd.toFixed(2)} | **+$${trailingResults[30].netProfitUsd.toFixed(2)}** | **+$${trailingResults[30].netProfitUsd.minus(staticResults[30].netProfitUsd).toFixed(2)} USD** |
| **ROI NETO (%)** | +${staticResults[30].netRoiPercent.toFixed(3)}% | **+${trailingResults[30].netRoiPercent.toFixed(3)}%** | **+${trailingResults[30].netRoiPercent.minus(staticResults[30].netRoiPercent).toFixed(3)}%** |
| **Horas Inactivo (Out of Bounds)** | ${staticResults[30].outOfBoundsHours} hrs | **${trailingResults[30].outOfBoundsHours} hrs** | **-${staticResults[30].outOfBoundsHours - trailingResults[30].outOfBoundsHours} hrs** |

---

### 🟢 90 Días:
| Métrica | Grilla Estática | Trailing Up (Dinámica) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | ${staticResults[90].totalFlipsCompleted} | **${trailingResults[90].totalFlipsCompleted}** | **+${trailingResults[90].totalFlipsCompleted - staticResults[90].totalFlipsCompleted} flips** |
| **Re-centrados Trailing Up** | N/A | **${trailingResults[90].trailingUpEventsCount} eventos** | - |
| **BENEFICIO NETO (USD)** | $${staticResults[90].netProfitUsd.toFixed(2)} | **+$${trailingResults[90].netProfitUsd.toFixed(2)}** | **+$${trailingResults[90].netProfitUsd.minus(staticResults[90].netProfitUsd).toFixed(2)} USD** |
| **ROI NETO (%)** | +${staticResults[90].netRoiPercent.toFixed(3)}% | **+${trailingResults[90].netRoiPercent.toFixed(3)}%** | **+${trailingResults[90].netRoiPercent.minus(staticResults[90].netRoiPercent).toFixed(3)}%** |
| **Horas Inactivo (Out of Bounds)** | ${staticResults[90].outOfBoundsHours} hrs | **${trailingResults[90].outOfBoundsHours} hrs** | **-${(staticResults[90].outOfBoundsHours - trailingResults[90].outOfBoundsHours).toFixed(1)} hrs** |

---

## 🔍 Conclusiones de la Estrategia Trailing Up

1. **Eliminación del Tiempo Inactivo al Alcista:**
   - Cuando el mercado de Bitcoin rompe el techo de la grilla y mantiene tendencia alcista, el bot no se queda "estancado esperando a que el precio vuelva a bajar".
   - Al consolidar 4 cierres por encima de la resistencia, desplaza la caja de $3,000 USD hacia arriba y vuelve a generar flujo continuo de comisiones y ganancias por volatilidad intradiaria.

2. **Seguridad y Liquidez en USDT:**
   - Como la grilla vendió progresivamente todo su Bitcoin a medida que subía el precio, al momento del re-centrado el bot dispone del 100% de la liquidez en USDT para sembrar las nuevas órdenes de compra por debajo del nuevo precio.
`;

  return md;
}

async function runBatchBacktest() {
  console.log('====================================================');
  console.log('🚀 Ejecutando Batch Backtesting: Estática vs Trailing Up');
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

    console.log(`[Simulación ${days} Días] Calculando Grilla Trailing Up (Dinámica)...`);
    trailingResults[days] = runBacktestForDays(candles, days, gridConfig, true);
  }

  const markdownReport = generateTrailingUpMarkdownReport(staticResults, trailingResults, gridConfig);

  fs.writeFileSync(REPORT_FILE, markdownReport, 'utf-8');
  console.log(`[Report Saved] 📄 Reporte Trailing Up guardado en: ${REPORT_FILE}`);

  console.log('\n' + markdownReport);
}

runBatchBacktest().catch((err) => {
  console.error('[Fatal Error] Error ejecutando batch backtest:', err);
  process.exit(1);
});
