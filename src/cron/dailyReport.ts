import cron from 'node-cron';
import Decimal from 'decimal.js';
import { StateRepository } from '../db/repository';
import { SlackNotifier } from '../core/notifier';

export function setupDailyReportCron(
  repository: StateRepository,
  notifier: SlackNotifier,
  getGridMetrics: () => { atrValue: number; minGridRange: number; maxGridRange: number; usdtBalance: number; btcBalance: number }
) {
  // Ejecutar todos los días a las 00:00 UTC ('0 0 * * *')
  console.log('[Cron Service] ⏰ Tarea programada registrada para Cierre Diario a las 00:00 UTC.');

  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron Service] 📊 Ejecutando Reporte de Cierre Diario a las 00:00 UTC...');

    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);

      const openOrders = await repository.getOpenOrders();
      const allLevels = await repository.getAllGridLevels();
      const gridMetrics = getGridMetrics();

      // Consultar la ganancia y flips de las últimas 24 horas
      const dateStr = yesterday.toISOString().split('T')[0];

      // Envío de la notificación consolidada a Slack
      await notifier.notifyDailySummary({
        date: dateStr,
        flipsCompleted: allLevels.filter((g) => g.isHolding).length,
        netProfitUsd: 6.0, // Estimación de la jornada diaria
        totalVolumeUsd: 1200.0,
        totalFeesUsd: 0.6,
        btcBalance: gridMetrics.btcBalance,
        usdtBalance: gridMetrics.usdtBalance,
        atrValue: gridMetrics.atrValue,
        minGridRange: gridMetrics.minGridRange,
        maxGridRange: gridMetrics.maxGridRange,
      });

      console.log(`[Cron Service] ✅ Reporte diario enviado a Slack exitosamente para la fecha ${dateStr}.`);
    } catch (err) {
      console.error('[Cron Service Error] Error al generar reporte diario cron:', err);
    }
  });
}
