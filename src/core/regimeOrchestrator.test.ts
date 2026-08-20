import { describe, it, expect } from 'vitest';
import { LiveRegimeOrchestrator } from './regimeOrchestrator';

describe('LiveRegimeOrchestrator - Real-Time Macro Market Regime Tests', () => {
  it('debe iniciar en estado CRAB y transicionar a BULL tras subida sostenida', () => {
    const orchestrator = new LiveRegimeOrchestrator(1.0); // 1% umbral
    expect(orchestrator.getRegime()).toBe('CRAB');

    // Inicializar a 60,000
    orchestrator.update1hClose(60000);

    // Simular rally de 1h subiendo agresivamente a 70,000
    for (let i = 0; i < 30; i++) {
      orchestrator.update1hClose(60000 + i * 400);
    }

    const state = orchestrator.update1hClose(72000);
    expect(state.regime).toBe('BULL');
    expect(state.regimeScorePct).toBeGreaterThan(1.0);
    expect(orchestrator.getRegime()).toBe('BULL');
  });

  it('debe transicionar a BEAR tras caída sostenida', () => {
    const orchestrator = new LiveRegimeOrchestrator(1.0);
    orchestrator.update1hClose(60000);

    // Simular dump sostenido a 45,000
    for (let i = 0; i < 30; i++) {
      orchestrator.update1hClose(60000 - i * 500);
    }

    const state = orchestrator.update1hClose(44000);
    expect(state.regime).toBe('BEAR');
    expect(state.regimeScorePct).toBeLessThan(-1.0);
    expect(orchestrator.getRegime()).toBe('BEAR');
  });
});
