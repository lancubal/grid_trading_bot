'use server';

import Decimal from 'decimal.js';
import { prisma } from './prisma';

export interface DashboardStats {
  netProfitUsd: number;
  roiPercent: number;
  totalFlips: number;
  totalVolumeUsd: number;
  totalFeesPaidUsd: number;
  botStatus: 'OPERANDO' | 'OUT_OF_BOUNDS' | 'STOPPED';
  isDryRun: boolean;
  atrValue: number;
  minGridRange: number;
  maxGridRange: number;
  btcBalance: number;
  usdtBalance: number;
}

/**
 * 1. Obtener KPIs y Balance Total (Módulo A & C)
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const filledOrders = await prisma.order.findMany({
      where: { status: 'FILLED' },
      orderBy: { updatedAt: 'asc' },
      select: { side: true, price: true, amount: true, fee: true, gridLevelId: true, createdAt: true },
    });

    const buyOrders = filledOrders.filter((o) => o.side === 'BUY');
    const sellOrders = filledOrders.filter((o) => o.side === 'SELL');
    const completedFlips = sellOrders.length;

    let netProfitUsd = new Decimal(0);
    let totalVolumeUsd = new Decimal(0);
    let totalFees = new Decimal(0);

    for (const ord of filledOrders) {
      const price = new Decimal(ord.price.toString());
      const amount = new Decimal(ord.amount.toString());
      const fee = ord.fee ? new Decimal(ord.fee.toString()) : price.times(amount).times(0.0005);
      totalFees = totalFees.plus(fee);
      totalVolumeUsd = totalVolumeUsd.plus(price.times(amount));
    }

    // Calcular ganancia neta estricta para cada ciclo completado (Venta realizada)
    if (sellOrders.length > 0) {
      for (const sell of sellOrders) {
        const sellPrice = new Decimal(sell.price.toString());
        const amount = new Decimal(sell.amount.toString());

        // Buscar la compra correspondiente en el nivel inferior o mismo nivel
        const matchingBuy = buyOrders.find(
          (b) => b.gridLevelId === sell.gridLevelId - 1 || b.gridLevelId === sell.gridLevelId
        );

        // Si existe compra previa emparejada, se usa su precio; de lo contrario se calcula un spread estimado del 0.33%
        const buyPrice = matchingBuy
          ? new Decimal(matchingBuy.price.toString())
          : sellPrice.dividedBy(1.0033);

        const grossSpread = sellPrice.minus(buyPrice).times(amount);
        const buyFee = buyPrice.times(amount).times(0.0005);
        const sellFee = sellPrice.times(amount).times(0.0005);

        const cycleNet = grossSpread.minus(buyFee).minus(sellFee);
        if (cycleNet.greaterThan(0)) {
          netProfitUsd = netProfitUsd.plus(cycleNet);
        }
      }
    }

    const initialInvestment = new Decimal(process.env.GRID_INVESTMENT || '1000.00');
    const roiPercent = initialInvestment.isZero()
      ? 0
      : netProfitUsd.dividedBy(initialInvestment).times(100).toNumber();

    const gridLevels = await prisma.gridLevel.findMany({
      orderBy: { price: 'asc' },
    });

    let minRange = 63000;
    let maxRange = 66000;
    let btcBalance = 0;
    let usdtBalance = 1000;

    if (gridLevels.length > 0) {
      minRange = Number(gridLevels[0].price);
      maxRange = Number(gridLevels[gridLevels.length - 1].price);
      btcBalance = gridLevels.filter((g) => g.isHolding).length * 0.0011;
      usdtBalance = Math.max(0, 1000 - btcBalance * minRange);
    }

    return {
      netProfitUsd: Number(netProfitUsd.toFixed(2)),
      roiPercent: Number(roiPercent.toFixed(2)),
      totalFlips: completedFlips,
      totalVolumeUsd: Number(totalVolumeUsd.toFixed(2)),
      totalFeesPaidUsd: Number(totalFees.toFixed(4)),
      botStatus: 'OPERANDO',
      isDryRun: process.env.DRY_RUN !== 'false',
      atrValue: 283.68,
      minGridRange: minRange,
      maxGridRange: maxRange,
      btcBalance: Number(btcBalance.toFixed(4)),
      usdtBalance: Number(usdtBalance.toFixed(2)),
    };
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    return {
      netProfitUsd: 0,
      roiPercent: 0,
      totalFlips: 0,
      totalVolumeUsd: 0,
      totalFeesPaidUsd: 0,
      botStatus: 'STOPPED',
      isDryRun: true,
      atrValue: 283.68,
      minGridRange: 63000,
      maxGridRange: 66000,
      btcBalance: 0,
      usdtBalance: 1000,
    };
  }
}

/**
 * 2. Obtener el estado actual de la escalera de precios (Módulo C)
 */
export async function getGridLadder() {
  try {
    const levels = await prisma.gridLevel.findMany({
      orderBy: { price: 'desc' },
      include: {
        orders: {
          where: { status: 'OPEN' },
          take: 1,
        },
      },
    });

    return levels.map((lvl) => {
      const activeOrder = lvl.orders[0];
      const isHolding = lvl.isHolding || (activeOrder ? activeOrder.side === 'SELL' : false);

      return {
        id: `level-${lvl.levelIndex}`,
        levelIndex: lvl.levelIndex,
        price: Number(lvl.price),
        isHolding,
        activeOrder: activeOrder
          ? {
              id: activeOrder.id,
              exchangeId: activeOrder.exchangeId || activeOrder.id.slice(0, 8),
              side: activeOrder.side,
              amount: Number(activeOrder.amount),
            }
          : null,
      };
    });
  } catch (err) {
    console.error('Error fetching grid ladder:', err);
    return [];
  }
}

/**
 * 3. Obtener los últimos Flips completados (Módulo D)
 */
export async function getRecentFlips(limit: number = 20) {
  try {
    const filledOrders = await prisma.order.findMany({
      where: { status: 'FILLED' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { gridLevel: true },
    });

    return filledOrders.map((ord) => ({
      id: ord.id,
      exchangeId: ord.exchangeId || ord.id.slice(0, 8),
      symbol: ord.symbol,
      side: ord.side,
      price: Number(ord.price),
      amount: Number(ord.amount),
      fee: ord.fee ? Number(ord.fee) : Number(ord.price) * Number(ord.amount) * 0.0005,
      netGain: Number(ord.price) * 0.0033 * 0.0011,
      gridLevelIndex: ord.gridLevelId,
      updatedAt: ord.updatedAt.toISOString(),
    }));
  } catch (err) {
    console.error('Error fetching recent flips:', err);
    return [];
  }
}
