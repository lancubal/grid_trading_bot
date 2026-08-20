export interface SimulationMetrics {
  initialCapital: number;
  finalEquity: number;
  netProfitUsd: number;
  roiPct: number;
  annualizedRoiPct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  totalVolumeUsd: number;
  feesPaidUsd: number;
  holdingBtcFinal: number;
  holdingBtcValueUsd: number;
  inventoryPenalty: number;
  activeDaysRatio: number;
  fitnessScore: number;
}

/**
 * Módulo de evaluación de rendimiento y cálculo de la función de costo (Fitness Function).
 * Maximiza el beneficio neto real en USD, el flujo continuo de flips y castiga la parálisis de liquidez.
 */
export class FitnessCalculator {
  /**
   * Calcula el Fitness Score a partir de los resultados de una simulación
   */
  public static evaluate(
    initialCapital: number,
    finalEquity: number,
    maxDrawdownPct: number,
    totalTrades: number,
    totalVolumeUsd: number,
    feesPaidUsd: number,
    finalBtcBalance: number,
    finalBtcPrice: number,
    durationDays: number,
    activeDaysCount: number = 0
  ): SimulationMetrics {
    const netProfitUsd = finalEquity - initialCapital;
    const roiPct = (netProfitUsd / initialCapital) * 100;

    const safeDays = Math.max(1, durationDays);
    const annualizedRoiPct = (roiPct * 365) / safeDays;

    // Proporción de días con actividad comercial
    const activeDaysRatio = activeDaysCount > 0 ? Math.min(1, activeDaysCount / safeDays) : Math.min(1, totalTrades / (safeDays * 2));

    // Penalización por inventario retenido en BTC al final
    const holdingBtcValueUsd = finalBtcBalance * finalBtcPrice;
    const btcRatio = holdingBtcValueUsd / (finalEquity > 0 ? finalEquity : 1);
    let inventoryPenalty = 0;
    if (btcRatio > 0.60) {
      inventoryPenalty = (btcRatio - 0.60) * 0.30;
    }

    // Factor de dinamismo por volumen de flips: log10(trades + 10)
    const tradeFactor = Math.max(1, Math.log10(Math.max(10, totalTrades)));

    // Ratio de Calmar Adaptado con premio por actividad constante
    let fitnessScore: number;
    if (netProfitUsd > 0) {
      // Retorno positivo: premiar ROI y consistencia de trades
      const safeDd = Math.max(1.0, maxDrawdownPct);
      const baseCalmar = (annualizedRoiPct / safeDd) * tradeFactor;
      fitnessScore = baseCalmar * (0.5 + 0.5 * activeDaysRatio) * (1 - inventoryPenalty);
    } else {
      // Retorno negativo: castigo proporcional a la pérdida y al drawdown
      fitnessScore = (annualizedRoiPct - 10) * (1 + (maxDrawdownPct / 50));
    }

    return {
      initialCapital,
      finalEquity,
      netProfitUsd,
      roiPct,
      annualizedRoiPct,
      maxDrawdownPct,
      totalTrades,
      totalVolumeUsd,
      feesPaidUsd,
      holdingBtcFinal: finalBtcBalance,
      holdingBtcValueUsd,
      inventoryPenalty,
      activeDaysRatio,
      fitnessScore,
    };
  }
}
