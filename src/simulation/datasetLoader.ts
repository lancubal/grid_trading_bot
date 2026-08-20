import fs from 'fs';
import readline from 'readline';

export interface CandleBuffer {
  length: number;
  timestamps: Float64Array;
  opens: Float64Array;
  highs: Float64Array;
  lows: Float64Array;
  closes: Float64Array;
  volumes: Float64Array;
}

export interface PartitionedDataset {
  train: CandleBuffer;
  test: CandleBuffer;
  totalCandles: number;
  startDate: Date;
  endDate: Date;
  trainEndDate: Date;
}

/**
 * Cargador de datasets de alto rendimiento en memoria RAM utilizando TypedArrays (Float64Array).
 * Lee el archivo CSV de velas de 1m y lo carga en matrices continuas de memoria sin sobrecarga de objetos.
 */
export class DatasetLoader {
  /**
   * Carga el archivo CSV y particiona en Train (In-Sample) y Test (Out-of-Sample)
   */
  public static async load(filePath: string, trainRatio = 0.70): Promise<PartitionedDataset> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Dataset no encontrado en ruta: ${filePath}. Ejecute 'npm run download-data' primero.`);
    }

    console.log(`[DatasetLoader] 📖 Escaneando dataset desde: ${filePath}...`);

    // 1. Primer barrido rápido: Contar líneas
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let totalLines = 0;
    for await (const line of rl) {
      if (line.trim().length > 0) totalLines++;
    }

    const dataLines = Math.max(0, totalLines - 1); // Descontar header
    console.log(`[DatasetLoader] 📊 Total velas de 1m detectadas: ${dataLines.toLocaleString()}`);

    if (dataLines === 0) {
      throw new Error(`El archivo CSV ${filePath} está vacío o no contiene datos.`);
    }

    // 2. Alocar Float64Arrays contiguos en memoria RAM
    const timestamps = new Float64Array(dataLines);
    const opens = new Float64Array(dataLines);
    const highs = new Float64Array(dataLines);
    const lows = new Float64Array(dataLines);
    const closes = new Float64Array(dataLines);
    const volumes = new Float64Array(dataLines);

    // 3. Segundo barrido: Parseo directo a TypedArrays
    const parseStream = fs.createReadStream(filePath);
    const parseRl = readline.createInterface({
      input: parseStream,
      crlfDelay: Infinity,
    });

    let index = 0;
    let isHeader = true;

    for await (const line of parseRl) {
      if (isHeader) {
        isHeader = false;
        continue;
      }

      if (!line.trim()) continue;

      // Formato CSV Binance: open_time,open,high,low,close,volume,...
      const parts = line.split(',');
      if (parts.length >= 6) {
        timestamps[index] = parseFloat(parts[0]);
        opens[index] = parseFloat(parts[1]);
        highs[index] = parseFloat(parts[2]);
        lows[index] = parseFloat(parts[3]);
        closes[index] = parseFloat(parts[4]);
        volumes[index] = parseFloat(parts[5]);
        index++;
      }
    }

    const actualCount = index;
    const trainCount = Math.floor(actualCount * trainRatio);
    const testCount = actualCount - trainCount;

    // 4. Crear sub-buffers compartidos (Zero-Copy slices)
    const train: CandleBuffer = {
      length: trainCount,
      timestamps: timestamps.subarray(0, trainCount),
      opens: opens.subarray(0, trainCount),
      highs: highs.subarray(0, trainCount),
      lows: lows.subarray(0, trainCount),
      closes: closes.subarray(0, trainCount),
      volumes: volumes.subarray(0, trainCount),
    };

    const test: CandleBuffer = {
      length: testCount,
      timestamps: timestamps.subarray(trainCount, actualCount),
      opens: opens.subarray(trainCount, actualCount),
      highs: highs.subarray(trainCount, actualCount),
      lows: lows.subarray(trainCount, actualCount),
      closes: closes.subarray(trainCount, actualCount),
      volumes: volumes.subarray(trainCount, actualCount),
    };

    const startDate = new Date(timestamps[0]);
    const endDate = new Date(timestamps[actualCount - 1]);
    const trainEndDate = new Date(timestamps[trainCount - 1]);

    console.log(`[DatasetLoader] ✅ Dataset cargado en memoria RAM.`);
    console.log(`• Rango Total: ${startDate.toISOString().split('T')[0]} ➔ ${endDate.toISOString().split('T')[0]}`);
    console.log(`• Train (In-Sample 70%): ${trainCount.toLocaleString()} velas (${startDate.toISOString().split('T')[0]} a ${trainEndDate.toISOString().split('T')[0]})`);
    console.log(`• Test (Out-of-Sample 30%): ${testCount.toLocaleString()} velas (${new Date(timestamps[trainCount]).toISOString().split('T')[0]} a ${endDate.toISOString().split('T')[0]})\n`);

    return {
      train,
      test,
      totalCandles: actualCount,
      startDate,
      endDate,
      trainEndDate,
    };
  }
}
