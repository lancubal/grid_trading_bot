import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';

// ==========================================
// CONFIGURACIÓN DEL DATASET
// ==========================================
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1m';
const START_YEAR = 2021; // Empezamos en 2021 para capturar el Bull Market
const END_YEAR = 2023;   // Hasta fin de 2023 (Cripto invierno y lateralización)

const DATASETS_DIR = path.resolve(__dirname, '../../datasets');
const OUTPUT_FILE = path.join(DATASETS_DIR, 'btc_historical_1m.csv');

// Los CSVs crudos de Binance no traen headers. Se los agregamos nosotros para mayor claridad.
const CSV_HEADERS = 'open_time,open,high,low,close,volume,close_time,quote_asset_volume,number_of_trades,taker_buy_base_asset_volume,taker_buy_quote_asset_volume,ignore\n';

export async function downloadAndExtract(startYear = START_YEAR, endYear = END_YEAR, targetFile = OUTPUT_FILE) {
  console.log(`====================================================`);
  console.log(`🚀 INICIANDO DESCARGA OFICIAL DESDE BINANCE PUBLIC DATA VISION`);
  console.log(`====================================================`);
  console.log(`• Par: ${SYMBOL} | Timeframe: ${INTERVAL}`);
  console.log(`• Rango Temporal: ${startYear} - ${endYear}`);
  console.log(`• Destino: ${targetFile}`);

  if (!fs.existsSync(DATASETS_DIR)) {
    fs.mkdirSync(DATASETS_DIR, { recursive: true });
  }

  // Preparamos el archivo maestro y le inyectamos los headers
  fs.writeFileSync(targetFile, CSV_HEADERS);

  let totalMonthsProcessed = 0;
  let totalRowsEstimated = 0;

  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthStr = month.toString().padStart(2, '0');
      const fileName = `${SYMBOL}-${INTERVAL}-${year}-${monthStr}`;
      const zipUrl = `https://data.binance.vision/data/spot/monthly/klines/${SYMBOL}/${INTERVAL}/${fileName}.zip`;

      process.stdout.write(`⬇️  Descargando: ${year}-${monthStr}... `);

      try {
        // Descargamos el ZIP directamente a la memoria RAM (arraybuffer)
        const response = await axios.get(zipUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        // Leemos y descomprimimos el ZIP en memoria
        const zip = new AdmZip(Buffer.from(response.data));
        const zipEntries = zip.getEntries();

        if (zipEntries.length > 0) {
          const csvData = zipEntries[0].getData().toString('utf8');
          const linesCount = (csvData.match(/\n/g) || []).length;

          // Concatenamos la data pura al archivo maestro (append)
          fs.appendFileSync(targetFile, csvData);
          totalMonthsProcessed++;
          totalRowsEstimated += linesCount;
          console.log(`✅ OK (${linesCount.toLocaleString()} velas de 1m añadidas)`);
        }
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          console.log(`⚠️ No disponible (404). Saltando...`);
        } else {
          console.log(`❌ Error: ${error.message}`);
        }
      }
    }
  }

  const stats = fs.statSync(targetFile);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`\n====================================================`);
  console.log(`🎉 DATASET MAESTRO CREADO CON ÉXITO`);
  console.log(`====================================================`);
  console.log(`• Meses procesados: ${totalMonthsProcessed}`);
  console.log(`• Total velas de 1m estimadas: ~${totalRowsEstimated.toLocaleString()}`);
  console.log(`• Tamaño de archivo: ${sizeMb} MB`);
  console.log(`• Ubicación: ${targetFile}\n`);
}

// Ejecución directa si se llama por CLI
if (require.main === module) {
  downloadAndExtract().catch((err) => {
    console.error('❌ Error fatal en descarga de datos:', err);
    process.exit(1);
  });
}
