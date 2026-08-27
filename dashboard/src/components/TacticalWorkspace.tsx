'use client';

import React from 'react';
import { DepthDomLevel, SemanticEvent } from '@/lib/actions';
import { Activity, ArrowDownRight, ArrowUpRight, Flame, Layers, Radio } from 'lucide-react';

interface TacticalWorkspaceProps {
  depthDom: {
    sells: DepthDomLevel[];
    buys: DepthDomLevel[];
    spotPrice: number;
  };
  semanticEvents: SemanticEvent[];
}

export function TacticalWorkspace({ depthDom, semanticEvents }: TacticalWorkspaceProps) {
  const { sells, buys, spotPrice } = depthDom;

  // Tomar hasta 4 órdenes de venta y 4 de compra para el Depth DOM vertical
  const displaySells = [...sells].reverse().slice(0, 4);
  const displayBuys = buys.slice(0, 4);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* 1. EL EJE DE LIQUIDEZ (DEPTH DOM EN VIVO) */}
      <div className="lg:col-span-6 glass-panel p-4 rounded-xl border border-slate-800 bg-slate-950/80 shadow-xl flex flex-col justify-between">
        <div className="flex items-center justify-between pb-2 border-b border-slate-900">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              Eje de Liquidez (Depth DOM)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Paso ATR: <span className="text-cyan-400 font-bold">$448 USD</span>
          </span>
        </div>

        {/* ESTRUCTURA VERTICAL APILADA */}
        <div className="my-3 space-y-1.5">
          {/* SECTOR VENTAS (Hacia arriba) */}
          <div className="space-y-1">
            {displaySells.map((lvl) => {
              const diff = lvl.price - spotPrice;
              const intensity = Math.min(100, (lvl.totalUsd / 380) * 100);
              return (
                <div
                  key={lvl.id}
                  className="relative overflow-hidden flex items-center justify-between px-3 py-2 rounded-lg border border-red-900/40 bg-red-950/20 text-xs font-mono transition-all hover:bg-red-950/40"
                >
                  <div
                    className="absolute inset-0 bg-red-500/10 pointer-events-none"
                    style={{ width: `${intensity}%` }}
                  />
                  <div className="flex items-center gap-2 z-10">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/60 text-red-300">
                      {lvl.layer}
                    </span>
                    <span className="font-bold text-red-400">${lvl.price.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-300 z-10">
                    <span>{lvl.amount.toFixed(4)} BTC</span>
                    <span className="font-semibold text-white">${lvl.totalUsd.toFixed(1)}</span>
                    <span className="text-red-400 text-[10px]">+{diff.toFixed(0)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* EJE SPOT CENTRAL (PULSO VIVO) */}
          <div className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-950/80 via-slate-900 to-cyan-950/80 border-2 border-cyan-500/50 flex items-center justify-between text-sm font-mono shadow-[0_0_20px_rgba(6,182,212,0.25)]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-extrabold text-cyan-400">SPOT ACTUAL:</span>
            </div>
            <span className="text-lg font-black text-white tracking-wider">
              ${spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
            </span>
          </div>

          {/* SECTOR COMPRAS (Hacia abajo) */}
          <div className="space-y-1">
            {displayBuys.map((lvl) => {
              const diff = spotPrice - lvl.price;
              const intensity = Math.min(100, (lvl.totalUsd / 380) * 100);
              return (
                <div
                  key={lvl.id}
                  className="relative overflow-hidden flex items-center justify-between px-3 py-2 rounded-lg border border-emerald-900/40 bg-emerald-950/20 text-xs font-mono transition-all hover:bg-emerald-950/40"
                >
                  <div
                    className="absolute inset-0 bg-emerald-500/10 pointer-events-none"
                    style={{ width: `${intensity}%` }}
                  />
                  <div className="flex items-center gap-2 z-10">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-900/60 text-emerald-300">
                      {lvl.layer}
                    </span>
                    <span className="font-bold text-emerald-400">${lvl.price.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-300 z-10">
                    <span>{lvl.amount.toFixed(4)} BTC</span>
                    <span className="font-semibold text-white">${lvl.totalUsd.toFixed(1)}</span>
                    <span className="text-emerald-400 text-[10px]">-{diff.toFixed(0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-900 text-[11px] font-mono text-slate-400">
          <span>Capacidad Micro: 25% ($750 USD)</span>
          <span className="text-emerald-400">● Inyección Continua Activa</span>
        </div>
      </div>

      {/* 2. FEED DE EVENTOS SEMÁNTICOS EN CASCADA */}
      <div className="lg:col-span-6 glass-panel p-4 rounded-xl border border-slate-800 bg-slate-950/80 shadow-xl flex flex-col justify-between">
        <div className="flex items-center justify-between pb-2 border-b border-slate-900">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Feed Semántico en Cascada
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 border border-slate-800 text-slate-400">
            Telemetría de Impacto Real
          </span>
        </div>

        <div className="my-2 space-y-2 max-h-[340px] overflow-y-auto pr-1">
          {semanticEvents.length === 0 ? (
            <div className="text-center py-12 text-slate-500 font-mono text-xs">
              Esperando nuevos eventos de ejecución...
            </div>
          ) : (
            semanticEvents.map((evt) => {
              const isProfit = evt.type === 'MACRO_TAKE_PROFIT' || evt.type === 'MICRO_SELL';
              return (
                <div
                  key={evt.id}
                  className="p-2.5 rounded-lg border border-slate-900 bg-slate-900/40 hover:bg-slate-900/70 transition-all font-mono text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-bold flex items-center gap-1 ${
                        isProfit ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {isProfit ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {evt.title}
                    </span>
                    <span className="text-[10px] text-slate-500">{evt.timeAgo}</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">{evt.description}</p>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] font-mono text-slate-500">
          <span>Compounding Automático</span>
          <span className="text-cyan-400 font-bold">100% de Flips Reinvertidos</span>
        </div>
      </div>
    </div>
  );
}
