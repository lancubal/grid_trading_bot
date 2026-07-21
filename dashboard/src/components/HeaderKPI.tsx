'use client';

import React from 'react';
import { Activity, ShieldAlert, ArrowUpRight, Repeat, Zap, RefreshCw } from 'lucide-react';
import { DashboardStats } from '../lib/actions';

interface HeaderKPIProps {
  stats: DashboardStats;
  currentPrice: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function HeaderKPI({ stats, currentPrice, onRefresh, isRefreshing }: HeaderKPIProps) {
  const isOutOfBounds =
    currentPrice > 0 &&
    (currentPrice < stats.minGridRange || currentPrice > stats.maxGridRange);

  const statusLabel = isOutOfBounds
    ? 'OUT OF BOUNDS - ESPERANDO VOLATILIDAD'
    : stats.botStatus === 'OPERANDO'
    ? 'OPERANDO'
    : 'STOPPED';

  const statusColorClass = isOutOfBounds
    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    : stats.botStatus === 'OPERANDO'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : 'bg-rose-500/10 text-rose-400 border-rose-500/30';

  const dotColorClass = isOutOfBounds
    ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
    : stats.botStatus === 'OPERANDO'
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
    : 'bg-rose-400 shadow-[0_0_8px_rgba(239,68,68,0.8)]';

  return (
    <header className="glass-panel p-4 rounded-xl shadow-2xl space-y-4">
      {/* Top Meta Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold tracking-wide uppercase glass-card">
            <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span className="text-slate-300">BOT BTC/USDT</span>
          </div>

          {/* Badge Estado Bot */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold tracking-wide uppercase ${statusColorClass}`}>
            <span className={`w-2.5 h-2.5 rounded-full pulse-indicator ${dotColorClass}`} />
            <span>{statusLabel}</span>
          </div>

          {/* Badge Modo Sombra */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-300 text-xs font-semibold tracking-wide">
            <ShieldAlert className="w-4 h-4 text-purple-400" />
            <span>{stats.isDryRun ? 'SHADOW TRADING (DRY-RUN)' : 'LIVE PRODUCTION'}</span>
          </div>
        </div>

        {/* Botón Refrescar */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 hover:text-white text-xs font-medium transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          <span>Sincronizar DB</span>
        </button>
      </div>

      {/* Grid de 4 Cards KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Beneficio Neto */}
        <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-emerald-500/40 transition-all group">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Beneficio Neto Acumulado</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-400 tracking-tight">
              +${stats.netProfitUsd.toFixed(2)}
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              +{stats.roiPercent}% ROI
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Deducidas comisiones Maker (0.05%)</p>
        </div>

        {/* Card 2: Flips Completados */}
        <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-cyan-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Flips Completados (Ciclos)</span>
            <Repeat className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white tracking-tight">
              {stats.totalFlips.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">ciclos</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Volumen: ${stats.totalVolumeUsd.toLocaleString()} USD</p>
        </div>

        {/* Card 3: ATR & Rango Dinámico */}
        <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-amber-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>ATR-14 & Rango Dinámico</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-base font-bold text-amber-300">
            ATR: ${stats.atrValue.toFixed(2)} USD
          </div>
          <p className="text-xs font-semibold text-slate-300 mt-1">
            Box: ${stats.minGridRange.toLocaleString()} - ${stats.maxGridRange.toLocaleString()}
          </p>
        </div>

        {/* Card 4: Precio BTC en Vivo */}
        <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-blue-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Precio BTC/USDT (Binance WS)</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-indicator" />
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            ${currentPrice > 0 ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Cargando...'}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Actualizado a 60 FPS directo desde Binance</p>
        </div>
      </div>
    </header>
  );
}
