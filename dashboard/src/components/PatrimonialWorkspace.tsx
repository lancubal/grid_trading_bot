'use client';

import React from 'react';
import { PatrimonialProgressData } from '@/lib/actions';
import { Home, Sparkles, TrendingUp, PiggyBank, ShieldCheck, DollarSign, ArrowRight } from 'lucide-react';

interface PatrimonialWorkspaceProps {
  data: PatrimonialProgressData;
}

export function PatrimonialWorkspace({ data }: PatrimonialWorkspaceProps) {
  const {
    baseCapital,
    netProfitUsd,
    currentEquityUsd,
    targetGoalUsd,
    progressPct,
    remainingUsd,
    feesPaidUsd,
    feesSavedUsd,
    protectedCapitalUsd,
  } = data;

  const baseRatio = (baseCapital / targetGoalUsd) * 100;
  const profitRatio = Math.max(0, (netProfitUsd / targetGoalUsd) * 100);

  return (
    <div className="glass-panel p-5 rounded-xl border border-slate-800 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-2xl space-y-6">
      {/* HEADER DE LA MISIÓN PATRIMONIAL */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-magenta-500/20 to-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shadow-lg">
            <Home className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide uppercase flex items-center gap-2">
              Misión Patrimonial: Consolidación hacia el Ladrillo
            </h3>
            <p className="text-xs font-mono text-slate-400">
              Transformando el flujo de caja algorítmico en acumulación de capital físico para tu casa.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] font-mono uppercase text-slate-400">Objetivo de Capital</span>
            <p className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 font-mono">
              ${targetGoalUsd.toLocaleString()} USD
            </p>
          </div>
        </div>
      </div>

      {/* 1. BARRA DE AVANCE MULTI-SEGMENTADA */}
      <div className="space-y-3 font-mono">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-blue-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              Base Inicial: ${baseCapital.toLocaleString()} USD
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              Profit Bot: +${netProfitUsd.toFixed(2)} USD
            </span>
          </div>
          <span className="text-sm font-black text-cyan-400">
            {progressPct.toFixed(2)}% Completado
          </span>
        </div>

        {/* CONTENEDOR DE LA BARRA */}
        <div className="w-full h-5 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex shadow-inner">
          {/* Segmento 1: Capital Base Inyectado */}
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-blue-500 transition-all duration-500"
            style={{ width: `${baseRatio}%` }}
            title={`Base Inicial: $${baseCapital} USD`}
          />
          {/* Segmento 2: Ganancia Realizada Reinvertida */}
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
            style={{ width: `${profitRatio}%` }}
            title={`Profit Generado: +$${netProfitUsd} USD`}
          />
          {/* Segmento 3: Faltante al Objetivo */}
          <div className="h-full flex-1 bg-slate-900/60" />
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Capital Consolidado Actual: <strong className="text-white">${currentEquityUsd.toLocaleString()} USD</strong></span>
          <span>Brecha Restante: <strong className="text-slate-300">${remainingUsd.toLocaleString()} USD</strong></span>
        </div>
      </div>

      {/* 2. TELEMETRÍA DE EFICIENCIA INVISIBLE (SHADOW ROI) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        {/* CARD 1: Comisiones Reales Pagadas */}
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/50 space-y-1 font-mono">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Comisiones Pagadas</span>
            <DollarSign className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="text-lg font-black text-amber-400">-${feesPaidUsd.toFixed(2)} USD</p>
          <p className="text-[10px] text-slate-500">Tarifa reducida 0.075% con saldo BNB</p>
        </div>

        {/* CARD 2: Ahorro Invisible Acumulado (85% Ahorro) */}
        <div className="p-4 rounded-xl border border-emerald-900/40 bg-emerald-950/20 space-y-1 font-mono shadow-[0_0_20px_rgba(16,185,129,0.1)]">
          <div className="flex items-center justify-between text-xs text-emerald-400">
            <span className="font-bold">Ahorro en Comisiones (85%)</span>
            <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
          </div>
          <p className="text-xl font-black text-emerald-300">+${feesSavedUsd.toFixed(2)} USD</p>
          <p className="text-[10px] text-slate-400">Dinero conservado gracias a la Doble Capa y TP 1.8x</p>
        </div>

        {/* CARD 3: Capital Defendido de Malventa */}
        <div className="p-4 rounded-xl border border-cyan-900/40 bg-cyan-950/20 space-y-1 font-mono">
          <div className="flex items-center justify-between text-xs text-cyan-400">
            <span className="font-bold">Bóveda Cero Malventa</span>
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-xl font-black text-cyan-300">${protectedCapitalUsd.toFixed(2)} USD</p>
          <p className="text-[10px] text-slate-400">Capital retenido esperando venta con ganancia en rebotes</p>
        </div>
      </div>
    </div>
  );
}
