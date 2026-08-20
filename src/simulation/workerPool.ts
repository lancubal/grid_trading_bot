import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import { CandleBuffer } from './datasetLoader';
import { BotHyperparameters, MemoryEngine } from './memoryEngine';
import { CandidateEvaluation } from './randomSearch';

export class SimulationWorkerPool {
  private workers: Worker[] = [];
  private readonly numThreads: number;
  private isInitialized = false;

  constructor(threadsCount?: number) {
    const totalCpus = os.cpus().length;
    this.numThreads = threadsCount || Math.max(1, totalCpus - 1); // Deja 1 núcleo libre para el OS
  }

  public getThreadCount(): number {
    return this.numThreads;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  /**
   * Evalúa una lista de candidatos distribuyendo la carga equitativamente entre los Worker Threads
   */
  public async evaluateBatch(
    candles: CandleBuffer,
    candidates: BotHyperparameters[],
    onProgress?: (completedCount: number, total: number) => void
  ): Promise<CandidateEvaluation[]> {
    if (candidates.length === 0) return [];

    // Si solo hay 1 hilo o pocos candidatos, ejecutar síncrono
    if (this.numThreads <= 1 || candidates.length <= 10) {
      let count = 0;
      const results: CandidateEvaluation[] = candidates.map((params) => {
        const metrics = MemoryEngine.run(candles, params);
        count++;
        if (onProgress && (count % 10 === 0 || count === candidates.length)) {
          onProgress(count, candidates.length);
        }
        return { params, metrics };
      });
      return results;
    }

    // Dividir en chunks para los workers
    const actualWorkers = Math.min(this.numThreads, candidates.length);
    const chunkSize = Math.ceil(candidates.length / actualWorkers);
    const chunks: BotHyperparameters[][] = [];

    for (let i = 0; i < candidates.length; i += chunkSize) {
      chunks.push(candidates.slice(i, i + chunkSize));
    }

    const workerFile = path.resolve(__dirname, 'worker.ts');
    let completedCount = 0;

    const workerPromises = chunks.map((chunk, workerIdx) => {
      return new Promise<CandidateEvaluation[]>((resolve, reject) => {
        try {
          const worker = new Worker(
            `
            const { parentPort } = require('worker_threads');
            const { MemoryEngine } = require('${path.resolve(__dirname, 'memoryEngine').replace(/\\/g, '/')}');

            parentPort.on('message', ({ id, candles, candidates }) => {
              try {
                const results = candidates.map(params => {
                  const metrics = MemoryEngine.run(candles, params);
                  return { params, metrics };
                });
                parentPort.postMessage({ id, success: true, results });
              } catch (err) {
                parentPort.postMessage({ id, success: false, error: err.message || err });
              }
            });
            `,
            { eval: true }
          );

          worker.on('message', (msg) => {
            worker.terminate();
            if (msg.success) {
              completedCount += chunk.length;
              if (onProgress) {
                onProgress(Math.min(completedCount, candidates.length), candidates.length);
              }
              resolve(msg.results);
            } else {
              reject(new Error(msg.error));
            }
          });

          worker.on('error', (err) => {
            worker.terminate();
            // Fallback síncrono si el worker falla
            console.warn(`[WorkerPool Warning] Worker falló (${err.message}). Ejecutando fallback en hilo principal...`);
            const fallbackResults = chunk.map((params) => ({
              params,
              metrics: MemoryEngine.run(candles, params),
            }));
            resolve(fallbackResults);
          });

          worker.postMessage({ id: workerIdx, candles, candidates: chunk });
        } catch (err) {
          // Fallback síncrono
          const fallbackResults = chunk.map((params) => ({
            params,
            metrics: MemoryEngine.run(candles, params),
          }));
          resolve(fallbackResults);
        }
      });
    });

    const resultsArray = await Promise.all(workerPromises);
    return resultsArray.flat();
  }

  public terminate(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
  }
}
