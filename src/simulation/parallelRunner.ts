import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import { CandleBuffer } from './datasetLoader';
import { BotHyperparameters, MemoryEngine } from './memoryEngine';
import { CandidateEvaluation } from './randomSearch';

export class ParallelEvaluator {
  public static getWorkerCount(): number {
    const totalCpus = os.cpus().length;
    return Math.max(1, totalCpus - 1);
  }

  public static async evaluateBatch(
    candles: CandleBuffer,
    candidates: BotHyperparameters[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<CandidateEvaluation[]> {
    const totalCandidates = candidates.length;
    if (totalCandidates === 0) return [];

    const workerCount = this.getWorkerCount();

    // Si solo hay 1 worker o pocos candidatos, procesar en el hilo principal
    if (workerCount <= 1 || totalCandidates <= 6) {
      let count = 0;
      return candidates.map((params) => {
        const metrics = MemoryEngine.run(candles, params);
        count++;
        if (onProgress && (count % 10 === 0 || count === totalCandidates)) {
          onProgress(count, totalCandidates);
        }
        return { params, metrics };
      });
    }

    // Dividir los candidatos en chunks equitativos para cada núcleo
    const actualWorkers = Math.min(workerCount, totalCandidates);
    const chunkSize = Math.ceil(totalCandidates / actualWorkers);
    const chunks: BotHyperparameters[][] = [];

    for (let i = 0; i < totalCandidates; i += chunkSize) {
      chunks.push(candidates.slice(i, i + chunkSize));
    }

    const workerPath = path.resolve(__dirname, 'simWorker.ts');
    let totalCompleted = 0;

    const workerPromises = chunks.map((chunk, idx) => {
      return new Promise<CandidateEvaluation[]>((resolve) => {
        try {
          const worker = new Worker(workerPath, {
            execArgv: ['--import', 'tsx'],
          });

          worker.on('message', (msg) => {
            worker.terminate();
            if (msg.success) {
              totalCompleted += chunk.length;
              if (onProgress) {
                onProgress(Math.min(totalCompleted, totalCandidates), totalCandidates);
              }
              resolve(msg.evaluations);
            } else {
              const fallback = chunk.map((params) => ({ params, metrics: MemoryEngine.run(candles, params) }));
              resolve(fallback);
            }
          });

          worker.on('error', () => {
            worker.terminate();
            const fallback = chunk.map((params) => ({ params, metrics: MemoryEngine.run(candles, params) }));
            resolve(fallback);
          });

          worker.postMessage({ taskId: idx, candles, candidates: chunk });
        } catch {
          const fallback = chunk.map((params) => ({ params, metrics: MemoryEngine.run(candles, params) }));
          resolve(fallback);
        }
      });
    });

    const results = await Promise.all(workerPromises);
    return results.flat();
  }
}
