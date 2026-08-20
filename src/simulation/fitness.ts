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
  fitnessScore: number;
}

/**
 * Módulo de evaluación de rendimiento y cálculo de la función de costo (Fitness Function).
 * Adapta el Ratio de Calmar con penalización por riesgo de inventario retenido.
 */
export class FitnessCalculator {
  /**
   * Calcula el Fitness Score a partir de los resultados de una simulación
   * @param initialCapital Capital inicial en USDT (ej: $2,000 USD)
   * @param finalEquity Patrimonio final total valorizado en USDT (USDT + BTC * P_final)
   * @param maxDrawdownPct Máxima caída porcentual de la curva de equity (0 a 100)
   * @param totalTrades Cantidad total de órdenes completadas (fills)
   * @param totalVolumeUsd Volumen total transaccionado en USD
   * @param feesPaidUsd Total de comisiones pagadas en USD (tasa 0.075%)
   * @param finalBtcBalance Cantidad de BTC retenida al finalizar
   * @param finalBtcPrice Precio de BTC al finalizar la simulación
   * @param durationDays Duración en días del período evaluado
   * @param riskFreeRatePct Tasa libre de riesgo anual (default: 4.5% anual de Binance Simple Earn)
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
    riskFreeRatePct = 4.5
  ): SimulationMetrics {
    const netProfitUsd = finalEquity - initialCapital;
    const roiPct = (netProfitUsd / initialCapital) * 100;

    // Anualización del ROI
    const safeDays = Math.max(1, durationDays);
    const annualizedRoiPct = (roiPct * 365) / safeDays;

    // Penalización por inventario retenido en la cima
    const holdingBtcValueUsd = finalBtcBalance * finalBtcPrice;
    const btcRatio = holdingBtcValueUsd / (finalEquity > 0 ? finalEquity : 1);

    // Si más del 50% del capital final quedó atrapado en BTC, se aplica una penalización proporcional
    let inventoryPenalty = 0;
    if (btcRatio > 0.50) {
      inventoryPenalty = (btcRatio - 0.50) * 0.50; // Hasta 25% de penalización si 100% es BTC
    }

    // Penalización si no operó casi nada (< 1 trade por semana)
    const minExpectedTrades = Math.floor(safeDays / 7);
    let activityPenalty = 0;
    if (totalTrades < minExpectedTrades) {
      activityPenalty = 0.50; // 50% de castigo por inactividad
    }

    // Ratio de Calmar adaptado: (ROI_Anualizado - TasaLibreDeRiesgo) / (MaxDrawdown + Epsilon)
    const excessReturn = annualizedRoiPct - riskFreeRatePct;
    const safeDrawdown = Math.max(0.5, maxDrawdownPct); // Epsilon de 0.5% para evitar división por cero

    let rawFitness = excessReturn / safeDrawdown;

    // Si el retorno es negativo, el fitness es negativo proporcional a la pérdida
    if (excessReturn < 0) {
      rawFitness = excessReturn * (safeDrawdown / 10);
    }

    // Aplicar penalizaciones
    const totalPenalty = Math.min(0.95, inventoryPenalty + activityPenalty);
    const fitnessScore = rawFitness * (1 - totalPenalty);

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
      fitnessScore,
    };
  }
}
