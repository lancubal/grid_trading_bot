import { isMainThread, parentPort, workerData } from 'worker_threads';
import { MemoryEngine, BotHyperparameters } from './memoryEngine';
import { CandleBuffer } from './datasetLoader';
import { CandidateEvaluation } from './randomSearch';

if (!isMainThread && parentPort) {
  parentPort.on('message', (task: { taskId: number; candles: CandleBuffer; candidates: BotHyperparameters[] }) => {
    try {
      const { taskId, candles, candidates } = task;
      const evaluations: CandidateEvaluation[] = candidates.map((params) => ({
        params,
        metrics: MemoryEngine.run(candles, params),
      }));

      parentPort?.postMessage({ taskId, success: true, evaluations });
    } catch (err: any) {
      parentPort?.postMessage({ taskId: task.taskId, success: false, error: err.message || String(err) });
    }
  });
}
