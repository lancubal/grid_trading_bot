'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { HeaderKPI } from '@/components/HeaderKPI';
import { TradingViewChart } from '@/components/TradingViewChart';
import { GridLadder } from '@/components/GridLadder';
import { ProfitPerformanceChart } from '@/components/ProfitPerformanceChart';
import { FlipsHistoryTable } from '@/components/FlipsHistoryTable';
import { ConsoleLogs } from '@/components/ConsoleLogs';
import { ReportGenerator } from '@/components/ReportGenerator';
import { getDashboardStats, getGridLadder, getRecentFlips, DashboardStats } from '@/lib/actions';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    netProfitUsd: 0,
    roiPercent: 0,
    totalFlips: 0,
    totalVolumeUsd: 0,
    totalFeesPaidUsd: 0,
    botStatus: 'OPERANDO',
    isDryRun: true,
    atrValue: 283.68,
    minGridRange: 63000,
    maxGridRange: 66000,
    btcBalance: 0,
    usdtBalance: 2000,
    gridInvestmentUsd: 2000,
    lifetimeAllocationUsd: 2000,
    maxLifetimeAllocationUsd: 2000,
    autoInjectCooldownDays: 20,
    lastInjectionDate: null,
  });

  const [gridLevels, setGridLevels] = useState<any[]>([]);
  const [flips, setFlips] = useState<any[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(66662);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchDashboardData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [newStats, newLadder, newFlips] = await Promise.all([
        getDashboardStats(),
        getGridLadder(),
        getRecentFlips(20),
      ]);

      setStats(newStats);
      if (newLadder && newLadder.length > 0) setGridLevels(newLadder);
      if (newFlips) setFlips(newFlips);
    } catch (err) {
      console.error('Error refreshing dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 5000); // Polling cada 5 segundos

    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  return (
    <main className="space-y-4 pb-8">
      {/* MÓDULO A: KPI Header */}
      <HeaderKPI
        stats={stats}
        currentPrice={currentPrice}
        onRefresh={fetchDashboardData}
        isRefreshing={isRefreshing}
      />

      {/* MÓDULO B & MÓDULO C: GRÁFICO PRINCIPAL DE GRILLA & MATRIZ ESCALONES (PRIORIDAD ALTA ARRIBA) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <TradingViewChart
            gridLevels={gridLevels}
            onPriceUpdate={(price) => setCurrentPrice(price)}
          />
        </div>

        <div className="lg:col-span-1">
          <GridLadder
            levels={gridLevels}
            currentPrice={currentPrice}
            btcBalance={stats.btcBalance}
            usdtBalance={stats.usdtBalance}
          />
        </div>
      </div>

      {/* MÓDULO PROFIT & ALPHA COMPARATIVO (UBICADO ABAJO DEL GRÁFICO ORIGINAL CON SELECTOR DE MODO) */}
      <ProfitPerformanceChart />

      {/* MÓDULO D: Historial de Flips */}
      <FlipsHistoryTable flips={flips} />

      {/* MÓDULO EXTRA: Generador de Reportes de Performance */}
      <ReportGenerator />

      {/* MÓDULO E: Logs y Volatilidad ATR */}
      <ConsoleLogs />
    </main>
  );
}
