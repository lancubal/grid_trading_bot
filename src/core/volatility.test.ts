import { describe, it, expect, vi } from 'vitest';
import Decimal from 'decimal.js';
import { LiveVolatilityEngine } from './volatility';

describe('LiveVolatilityEngine - Real-Time ATR Volatility Monitoring', () => {
  it('debe emitir el evento VOLATILITY_CHANGE solo cuando el ATR varía un 15% o más', async () => {
    const engine = new LiveVolatilityEngine(15);
    const listenerSpy = vi.fn();
    engine.on('VOLATILITY_CHANGE', listenerSpy);

    const mockCcxt = {
      fetchOHLCV: vi.fn(),
    };

    // Vela mock inicial con rango $200 -> ATR ~ 200
    const baseCandles = Array.from({ length: 20 }, (_, i) => [
      Date.now() + i * 3600000,
      64000,
      64200,
      64000,
      64100,
      10,
    ]);

    mockCcxt.fetchOHLCV.mockResolvedValueOnce(baseCandles);
    const initialAtr = await engine.evaluateVolatility(mockCcxt, 'BTC/USDT', '1h', 14);

    expect(initialAtr?.toFixed(0)).toBe('200');
    expect(listenerSpy).not.toHaveBeenCalled(); // El primer valor solo establece el baseline

    // Segunda evaluación con pequeña variación (ATR 210 -> 5% variación): No debe emitir
    const smallVariationCandles = Array.from({ length: 20 }, (_, i) => [
      Date.now() + i * 3600000,
      64000,
      64210,
      64000,
      64100,
      10,
    ]);

    mockCcxt.fetchOHLCV.mockResolvedValueOnce(smallVariationCandles);
    await engine.evaluateVolatility(mockCcxt, 'BTC/USDT', '1h', 14);
    expect(listenerSpy).not.toHaveBeenCalled();

    // Tercera evaluación con gran variación (ATR 300 -> 50% variación >= 15%): Debe emitir!
    const largeVariationCandles = Array.from({ length: 20 }, (_, i) => [
      Date.now() + i * 3600000,
      64000,
      64300,
      64000,
      64100,
      10,
    ]);

    mockCcxt.fetchOHLCV.mockResolvedValueOnce(largeVariationCandles);
    await engine.evaluateVolatility(mockCcxt, 'BTC/USDT', '1h', 14);

    expect(listenerSpy).toHaveBeenCalledTimes(1);
    const emittedAtr = listenerSpy.mock.calls[0][0] as Decimal;
    expect(emittedAtr.toFixed(0)).toBe('300');
  });
});
