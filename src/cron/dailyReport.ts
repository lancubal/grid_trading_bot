import cron from 'node-cron';
import Decimal from 'decimal.js';
import { StateRepository } from '../db/repository';
import { SlackNotifier, DailySummaryData } from '../core/notifier';
import { IExchangeAdapter } from '../exchange/adapter';
import { GridManager } from '../core/gridManager';
import { LiveVolatilityEngine } from '../core/volatility';
import { OrderSide } from '@prisma/client';

export function setupDailyReportCron(
  repository: StateRepository,
  notifier: SlackNotifier,
  exchangeAdapter: IExchangeAdapter,
  gridManager: GridManager,
  volatilityEngine: LiveVolatilityEngine,
  symbol: string = 'BTC/USDT'
) {
  // Ejecutar todos los días a las 00:00 UTC ('0 0 * * *')
  console.log('[Cron Service] ⏰ Tarea programada registrada para Cierre Diario a las 00:00 UTC.');

  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron Service] 📊 Ejecutando Reporte de Cierre Diario a las 00:00 UTC...');

    try {
      const now = new Date();
      // Ventana de 24 horas del día previo (00:00:00.000 UTC a 23:59:59.999 UTC)
      const yesterdayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0));
      const yesterdayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));
      const dateStr = yesterdayStart.toISOString().split('T')[0];

      // 1. Consultar órdenes ejecutadas (FILLED) en el período de 24h
      const filledOrders = await repository.getOrdersFilledInDateRange(yesterdayStart, yesterdayEnd);
      const filledLegacyOrders = await repository.getLegacyOrdersFilledInDateRange(yesterdayStart, yesterdayEnd);
      const openLegacyOrders = await repository.getOpenLegacyOrders();

      let totalBuyOrders = 0;
      let totalSellOrders = 0;
      let totalVolumeUsd = new Decimal(0);
      let totalFeesUsd = new Decimal(0);
      let netProfitUsd = new Decimal(0);
      const stepSize = gridManager.getStepSize();

      for (const ord of filledOrders) {
        const price = new Decimal(ord.price);
        const amount = new Decimal(ord.amount);
        const orderVol = price.times(amount);
        totalVolumeUsd = totalVolumeUsd.plus(orderVol);

        const feeCost = ord.feeCost ? new Decimal(ord.feeCost) : orderVol.times(0.00075);
        totalFeesUsd = totalFeesUsd.plus(feeCost);

        if (ord.side === OrderSide.BUY) {
          totalBuyOrders++;
        } else if (ord.side === OrderSide.SELL) {
          totalSellOrders++;
          // Ganancia bruta de la venta = escalón (stepSize) * monto
          const grossProfit = stepSize.times(amount);
          const orderProfit = Decimal.max(0.005, grossProfit.minus(feeCost));
          netProfitUsd = netProfitUsd.plus(orderProfit);
        }
      }

      // 2. Métricas de la Bóveda Legacy
      let legacyRecoveredUsdt = new Decimal(0);
      for (const leg of filledLegacyOrders) {
        const legVol = new Decimal(leg.price).times(new Decimal(leg.amount));
        const legFee = leg.feeCost ? new Decimal(leg.feeCost) : legVol.times(0.00075);
        legacyRecoveredUsdt = legacyRecoveredUsdt.plus(legVol.minus(legFee));
      }

      let openLegacyBtc = new Decimal(0);
      let openLegacyUsdValue = new Decimal(0);
      for (const leg of openLegacyOrders) {
        const legAmt = new Decimal(leg.amount);
        const legPrice = new Decimal(leg.price);
        openLegacyBtc = openLegacyBtc.plus(legAmt);
        openLegacyUsdValue = openLegacyUsdValue.plus(legAmt.times(legPrice));
      }

      // 3. Consultar balances físicos reales en Binance Spot
      let usdtFree = 0;
      let btcFree = 0;
      let totalEquity = 0;
      try {
        const balance = await exchangeAdapter.fetchBalance();
        usdtFree = balance.free['USDT'] ? Number(balance.free['USDT']) : 0;
        btcFree = balance.free['BTC'] ? Number(balance.free['BTC']) : 0;

        const ticker = await exchangeAdapter.fetchTicker(symbol);
        const usdtTotal = balance.total['USDT'] ? Number(balance.total['USDT']) : usdtFree;
        const btcTotal = balance.total['BTC'] ? Number(balance.total['BTC']) : btcFree;
        totalEquity = usdtTotal + btcTotal * Number(ticker.last);
      } catch (err) {
        console.warn('[Daily Report Balance Warning] Error consultando balance en Binance:', err);
      }

      // 4. Métricas de la Grilla Activa
      const gridConfig = gridManager.getConfig();
      const currentAtr = volatilityEngine.getCurrentAtr() || new Decimal(200);

      const summaryData: DailySummaryData = {
        date: dateStr,
        flipsCompleted: totalSellOrders,
        totalBuyOrders,
        totalSellOrders,
        netProfitUsd: netProfitUsd.toNumber(),
        totalVolumeUsd: totalVolumeUsd.toNumber(),
        totalFeesUsd: totalFeesUsd.toNumber(),
        btcBalance: btcFree,
        usdtBalance: usdtFree,
        totalEquityUsd: totalEquity,
        atrValue: currentAtr.toNumber(),
        minGridRange: gridConfig.lowerPrice.toNumber(),
        maxGridRange: gridConfig.upperPrice.toNumber(),
        stepSize: stepSize.toNumber(),
        legacyVault: {
          openOrdersCount: openLegacyOrders.length,
          totalBtc: openLegacyBtc.toNumber(),
          totalUsdValue: openLegacyUsdValue.toNumber(),
          fillsCompletedYesterday: filledLegacyOrders.length,
          recoveredUsdtYesterday: legacyRecoveredUsdt.toNumber(),
        },
      };

      // 5. Envío de la notificación a Slack
      await notifier.notifyDailySummary(summaryData);

      console.log(`[Cron Service] ✅ Reporte diario enviado a Slack exitosamente para la fecha ${dateStr}.`);
    } catch (err) {
      console.error('[Cron Service Error] Error al generar reporte diario cron:', err);
    }
  });
}
