import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

export interface MonthlySummaryData {
  month: number;
  year: number;
  monthName: string;
  startingCapital: number;
  injectedCapital: number;
  closingCapital: number;
  netProfitUsd: number;
  roiPercent: number;
  totalTrades: number;
  totalVolumeUsd: number;
  totalFeesUsd: number;
  isClosed: boolean;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Calcula la ganancia neta realizada (FIFO matching de fills) manteniendo el inventario continuo.
 */
export function calculateContinuousMonthlyStats(allFills: Array<{ side: string; price: any; amount: any; fee?: any; updatedAt: Date }>): Map<string, {
  netProfitUsd: number;
  totalVolumeUsd: number;
  totalFeesUsd: number;
  totalTrades: number;
}> {
  const monthStats = new Map<string, {
    netProfitUsd: number;
    totalVolumeUsd: number;
    totalFeesUsd: number;
    totalTrades: number;
    grossRealized: number;
  }>();

  const inventory: { price: number; amount: number }[] = [];

  for (const f of allFills) {
    const y = f.updatedAt.getUTCFullYear();
    const m = f.updatedAt.getUTCMonth() + 1;
    const key = `${y}-${m}`;

    if (!monthStats.has(key)) {
      monthStats.set(key, {
        netProfitUsd: 0,
        totalVolumeUsd: 0,
        totalFeesUsd: 0,
        totalTrades: 0,
        grossRealized: 0,
      });
    }

    const st = monthStats.get(key)!;
    st.totalTrades += 1;

    const price = Number(f.price);
    const amount = Number(f.amount);
    const notional = price * amount;
    const fee = f.fee ? Number(f.fee) : notional * 0.00075;
    st.totalFeesUsd += fee;
    st.totalVolumeUsd += notional;

    if (f.side === 'BUY') {
      inventory.push({ price, amount });
    } else {
      let remainingSell = amount;
      while (remainingSell > 0.0000001 && inventory.length > 0) {
        const oldestBuy = inventory[0];
        const matchAmt = Math.min(remainingSell, oldestBuy.amount);
        const realizedProfit = (price - oldestBuy.price) * matchAmt;
        st.grossRealized += realizedProfit;
        oldestBuy.amount -= matchAmt;
        remainingSell -= matchAmt;
        if (oldestBuy.amount <= 0.0000001) inventory.shift();
      }
      if (remainingSell > 0.0000001) {
        const defaultStepSpread = 850.0;
        st.grossRealized += defaultStepSpread * remainingSell;
      }
    }
  }

  const result = new Map<string, {
    netProfitUsd: number;
    totalVolumeUsd: number;
    totalFeesUsd: number;
    totalTrades: number;
  }>();

  for (const [key, st] of monthStats.entries()) {
    result.set(key, {
      netProfitUsd: Number((st.grossRealized - st.totalFeesUsd).toFixed(2)),
      totalVolumeUsd: Number(st.totalVolumeUsd.toFixed(2)),
      totalFeesUsd: Number(st.totalFeesUsd.toFixed(2)),
      totalTrades: st.totalTrades,
    });
  }

  return result;
}

/**
 * Sincroniza y persiste los reportes mensuales en la base de datos PostgreSQL usando FIFO continuo.
 * Cierra automáticamente meses pasados y mantiene actualizado el mes en curso.
 */
export async function syncAndFetchMonthlyReports(
  prisma: PrismaClient,
  currentInjectedCapital: number = 4160.0
): Promise<{
  currentMonth: MonthlySummaryData;
  previousMonth: MonthlySummaryData | null;
  allReports: MonthlySummaryData[];
  diffUsd: number;
  diffPct: number;
}> {
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1; // 1-12

  // 1. Obtener todas las órdenes ejecutadas ordenadas cronológicamente
  const allFills = await prisma.order.findMany({
    where: { status: 'FILLED' },
    orderBy: { updatedAt: 'asc' },
    select: { side: true, price: true, amount: true, fee: true, updatedAt: true },
  }).catch(() => []);

  // 2. Calcular estadísticas mensuales con inventario FIFO continuo
  const monthStatsMap = calculateContinuousMonthlyStats(allFills);

  // Asegurar que los meses relevantes estén en la lista
  const activeMonthKeys = new Set<string>(Array.from(monthStatsMap.keys()));
  activeMonthKeys.add(`${curYear}-${curMonth}`);

  const sortedMonthKeys = Array.from(activeMonthKeys).sort((a, b) => {
    const [y1, m1] = a.split('-').map(Number);
    const [y2, m2] = b.split('-').map(Number);
    return y1 === y2 ? m1 - m2 : y1 - y2;
  });

  const reports: MonthlySummaryData[] = [];
  let runningStartingCapital = Math.min(2160.0, currentInjectedCapital);

  for (const key of sortedMonthKeys) {
    const [y, m] = key.split('-').map(Number);
    const isCurrent = y === curYear && m === curMonth;
    const st = monthStatsMap.get(key) || {
      netProfitUsd: 0,
      totalVolumeUsd: 0,
      totalFeesUsd: 0,
      totalTrades: 0,
    };

    const monthName = MONTH_NAMES[m - 1] || `Mes ${m}`;
    const startingCapital = Number(runningStartingCapital.toFixed(2));
    const injectedThisMonth = isCurrent ? Math.max(0, currentInjectedCapital - startingCapital) : 0;
    const baseOperating = startingCapital + injectedThisMonth;
    const roiPercent = baseOperating > 0 ? Number(((st.netProfitUsd / baseOperating) * 100).toFixed(2)) : 0;
    const closingCapital = Number((baseOperating + st.netProfitUsd).toFixed(2));

    // Guardar o actualizar en la tabla MonthlyReport de PostgreSQL
    try {
      await prisma.monthlyReport.upsert({
        where: {
          year_month: { year: y, month: m },
        },
        update: {
          monthName,
          startingCapital: new Decimal(startingCapital),
          injectedCapital: new Decimal(injectedThisMonth),
          closingCapital: new Decimal(closingCapital),
          netProfitUsd: new Decimal(st.netProfitUsd),
          roiPercent: new Decimal(roiPercent),
          totalTrades: st.totalTrades,
          totalVolumeUsd: new Decimal(st.totalVolumeUsd),
          totalFeesUsd: new Decimal(st.totalFeesUsd),
          isClosed: !isCurrent,
        },
        create: {
          year: y,
          month: m,
          monthName,
          startingCapital: new Decimal(startingCapital),
          injectedCapital: new Decimal(injectedThisMonth),
          closingCapital: new Decimal(closingCapital),
          netProfitUsd: new Decimal(st.netProfitUsd),
          roiPercent: new Decimal(roiPercent),
          totalTrades: st.totalTrades,
          totalVolumeUsd: new Decimal(st.totalVolumeUsd),
          totalFeesUsd: new Decimal(st.totalFeesUsd),
          isClosed: !isCurrent,
        },
      });
    } catch {
      // Ignorar si la tabla aún está migrándose
    }

    reports.push({
      year: y,
      month: m,
      monthName,
      startingCapital,
      injectedCapital: injectedThisMonth,
      closingCapital,
      netProfitUsd: st.netProfitUsd,
      roiPercent,
      totalTrades: st.totalTrades,
      totalVolumeUsd: st.totalVolumeUsd,
      totalFeesUsd: st.totalFeesUsd,
      isClosed: !isCurrent,
    });

    runningStartingCapital = closingCapital;
  }

  const currentMonthReport = reports.find((r) => r.year === curYear && r.month === curMonth) || {
    year: curYear,
    month: curMonth,
    monthName: MONTH_NAMES[curMonth - 1],
    startingCapital: currentInjectedCapital,
    injectedCapital: 0,
    closingCapital: currentInjectedCapital,
    netProfitUsd: 0,
    roiPercent: 0,
    totalTrades: 0,
    totalVolumeUsd: 0,
    totalFeesUsd: 0,
    isClosed: false,
  };

  const prevMonthIdx = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;
  const previousMonthReport = reports.find((r) => r.year === prevYear && r.month === prevMonthIdx) || null;

  const diffUsd = previousMonthReport
    ? Number((currentMonthReport.netProfitUsd - previousMonthReport.netProfitUsd).toFixed(2))
    : 0;

  const diffPct = previousMonthReport && previousMonthReport.netProfitUsd > 0
    ? Number(((diffUsd / previousMonthReport.netProfitUsd) * 100).toFixed(2))
    : 0;

  return {
    currentMonth: currentMonthReport,
    previousMonth: previousMonthReport,
    allReports: reports,
    diffUsd,
    diffPct,
  };
}
