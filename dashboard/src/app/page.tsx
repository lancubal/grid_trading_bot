'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { HeaderKPI } from '@/components/HeaderKPI';
import { TimelineTradeChart } from '@/components/TimelineTradeChart';
import { TacticalWorkspace } from '@/components/TacticalWorkspace';
import { StructuralWorkspace } from '@/components/StructuralWorkspace';
import { PatrimonialWorkspace } from '@/components/PatrimonialWorkspace';
import { ProfitPerformanceChart } from '@/components/ProfitPerformanceChart';
import { FlipsHistoryTable } from '@/components/FlipsHistoryTable';
import { ReportGenerator } from '@/components/ReportGenerator';
import { ConsoleLogs } from '@/components/ConsoleLogs';
import {
  getDashboardStats,
  getTacticalDepthDom,
  getSemanticEventFeed,
  getStructuralLegacyVault,
  getPatrimonialProgress,
  getTimelineTradeMarkers,
  getRecentFlips,
  DashboardStats,
  DepthDomLevel,
  SemanticEvent,
  LegacyVaultData,
  PatrimonialProgressData,
  TimelineTradeMarker,
} from '@/lib/actions';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    netProfitUsd: 0,
    roiPercent: 0,
    totalFlips: 0,
    totalVolumeUsd: 0,
    totalFeesPaidUsd: 0,
    botStatus: 'OPERANDO',
    isDryRun: false,
    atrValue: 856.38,
    minGridRange: 75000,
    maxGridRange: 82000,
    btcBalance: 0.0108,
    usdtBalance: 1449.32,
    gridInvestmentUsd: 3000,
    lifetimeAllocationUsd: 3000,
    maxLifetimeAllocationUsd: 3000,
    autoInjectCooldownDays: 20,
    lastInjectionDate: null,
  });

  const [currentPrice, setCurrentPrice] = useState<number>(77270);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Estados de los 3 Workspaces & Telemetría
  const [depthDom, setDepthDom] = useState<{ sells: DepthDomLevel[]; buys: DepthDomLevel[]; spotPrice: number }>({
    sells: [],
    buys: [],
    spotPrice: 77270,
  });

  const [semanticEvents, setSemanticEvents] = useState<SemanticEvent[]>([]);
  const [legacyVault, setLegacyVault] = useState<LegacyVaultData>({
    totalLegacyOrders: 0,
    totalFrozenBtc: 0,
    totalFrozenUsd: 0,
    avgRescuePct: 100,
    orders: [],
  });

  const [patrimonialData, setPatrimonialData] = useState<PatrimonialProgressData>({
    baseCapital: 3000,
    netProfitUsd: 12.08,
    currentEquityUsd: 3012.08,
    targetGoalUsd: 30000,
    progressPct: 10.04,
    remainingUsd: 26987.92,
    feesPaidUsd: 2.62,
    feesSavedUsd: 48.5,
    protectedCapitalUsd: 861.0,
    totalVolumeUsd: 3495.8,
    totalTrades: 18,
  });

  const [tradeMarkers, setTradeMarkers] = useState<TimelineTradeMarker[]>([]);
  const [flips, setFlips] = useState<any[]>([]);

  const fetchDashboardData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [
        newStats,
        newDepthDom,
        newEvents,
        newLegacyVault,
        newPatrimonial,
        newMarkers,
        newFlips,
      ] = await Promise.all([
        getDashboardStats(),
        getTacticalDepthDom(currentPrice),
        getSemanticEventFeed(15),
        getStructuralLegacyVault(currentPrice),
        getPatrimonialProgress(30000),
        getTimelineTradeMarkers(80),
        getRecentFlips(20),
      ]);

      setStats(newStats);
      if (newDepthDom) setDepthDom(newDepthDom);
      if (newEvents) setSemanticEvents(newEvents);
      if (newLegacyVault) setLegacyVault(newLegacyVault);
      if (newPatrimonial) setPatrimonialData(newPatrimonial);
      if (newMarkers) setTradeMarkers(newMarkers);
      if (newFlips) setFlips(newFlips);
    } catch (err) {
      console.error('Error fetching quantum telemetry data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [currentPrice]);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 4000); // Polling activo cada 4 segundos

    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  return (
    <main className="space-y-6 pb-12">
      {/* HEADER DE TELEMETRÍA PRINCIPAL */}
      <HeaderKPI
        stats={stats}
        currentPrice={currentPrice}
        onRefresh={fetchDashboardData}
        isRefreshing={isRefreshing}
      />

      {/* 🏡 WORKSPACE PATRIMONIAL (DESTACADO: MISIÓN HACIA EL LADRILLO $30K) */}
      <PatrimonialWorkspace data={patrimonialData} />

      {/* 📈 GRÁFICO PRINCIPAL: LÍNEA DE TIEMPO CON MARCADORES DE TRADES & CANAL ATR */}
      <TimelineTradeChart
        markers={tradeMarkers}
        atrFloor={stats.minGridRange}
        atrCeiling={stats.maxGridRange}
        currentSpotPrice={currentPrice}
        onPriceUpdate={(p) => setCurrentPrice(p)}
      />

      {/* ⚡ 1. WORKSPACE TÁCTICO: EJE DE LIQUIDEZ (DEPTH DOM) + FEED SEMÁNTICO */}
      <TacticalWorkspace
        depthDom={depthDom}
        semanticEvents={semanticEvents}
      />

      {/* 🏛️ 2. WORKSPACE ESTRUCTURAL: ESTRATOS GEOLÓGICOS LEGACY + RADAR MACRO */}
      <StructuralWorkspace
        legacyVault={legacyVault}
        macroOrders={[...depthDom.sells, ...depthDom.buys]}
        currentSpotPrice={currentPrice}
      />

      {/* 📊 ANÁLISIS DE ALPHA COMPARATIVO & HISTORIAL DETALLADO */}
      <ProfitPerformanceChart />
      <FlipsHistoryTable flips={flips} />
      <ReportGenerator />
      <ConsoleLogs />
    </main>
  );
}
