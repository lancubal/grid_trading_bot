'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { HeaderKPI } from '@/components/HeaderKPI';
import { TradingViewChart } from '@/components/TradingViewChart';
import { GridLadder } from '@/components/GridLadder';
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
    usdtBalance: 1000,
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
      if (newLadder.length > 0) setGridLevels(newLadder);
      setFlips(newFlips);
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
      {/* Banner Túnel SSH Instucciones Rápidas */}
      <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-300 font-medium">Túnel SSH AWS Activo (`localhost:5433` ➔ AWS EC2 `100.27.216.84`)</span>
        </div>
        <code className="bg-slate-950 px-3 py-1 rounded text-cyan-300 font-mono select-all border border-slate-800">
          ssh -i ./Downloads/trading-bot-key.pem -N -L 5433:localhost:5432 ubuntu@100.27.216.84
        </code>
      </div>

      {/* MÓDULO A: KPI Header */}
      <HeaderKPI
        stats={stats}
        currentPrice={currentPrice}
        onRefresh={fetchDashboardData}
        isRefreshing={isRefreshing}
      />

      {/* MÓDULO B & MÓDULO C (Gráfico + Matriz Escalones) */}
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

      {/* MÓDULO D: Historial de Flips */}
      <FlipsHistoryTable flips={flips} />

      {/* MÓDULO EXTRA: Generador de Reportes de Performance */}
      <ReportGenerator />

      {/* MÓDULO E: Logs y Volatilidad ATR */}
      <ConsoleLogs />
    </main>
  );
}
