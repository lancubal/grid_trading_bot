import { parentPort, workerData } from 'worker_threads';
import { MemoryEngine, BotHyperparameters } from './memoryEngine';
import { CandleBuffer } from './datasetLoader';
import { CandidateEvaluation } from './randomSearch';

if (parentPort) {
  parentPort.on('message', (message: { id: number; candles: CandleBuffer; candidates: BotHyperparameters[] }) => {
    try {
      const { id, candles, candidates } = message;
      const results: CandidateEvaluation[] = candidates.map((params) => {
        const metrics = MemoryEngine.run(candles, params);
        return { params, metrics };
      });

      parentPort?.postMessage({ id, success: true, results });
    } catch (err: any) {
      parentPort?.postMessage({ id: message.id, success: false, error: err.message || err });
    }
  });
}
