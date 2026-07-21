'use client';

import React from 'react';
import { Layers, ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';

interface GridLadderItem {
  id: string;
  levelIndex: number;
  price: number;
  isHolding: boolean;
  activeOrder?: {
    id: string;
    exchangeId?: string;
    side: string;
    amount: number;
  } | null;
}

interface GridLadderProps {
  levels: GridLadderItem[];
  currentPrice: number;
  btcBalance: number;
  usdtBalance: number;
}

export function GridLadder({ levels, currentPrice, btcBalance, usdtBalance }: GridLadderProps) {
  return (
    <div className="glass-panel p-4 rounded-xl space-y-4 h-full flex flex-col justify-between">
      <div className="space-y-3">
        {/* Banner Titulo + Asignación de Capital */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold tracking-wide text-white uppercase">
              Matriz de Escalones (Ladder)
            </h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
            {levels.length} Niveles
          </span>
        </div>

        {/* Card Desglose de Capital */}
        <div className="glass-card p-3 rounded-lg flex items-center justify-between gap-4 border border-slate-800">
          <div className="flex items-center gap-2 text-xs">
            <Wallet className="w-4 h-4 text-purple-400" />
            <span className="text-slate-400 font-medium">Asignación:</span>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-emerald-400 font-bold">{usdtBalance.toFixed(2)} USDT</span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400 font-bold">{btcBalance.toFixed(4)} BTC</span>
          </div>
        </div>

        {/* Tabla Vertical Descendente */}
        <div className="overflow-y-auto max-h-[380px] pr-1 space-y-1.5">
          {levels.map((lvl) => {
            const isNearCurrentPrice =
              currentPrice > 0 && Math.abs(currentPrice - lvl.price) < 150;

            const isHolding = lvl.isHolding;

            return (
              <div
                key={lvl.id}
                className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                  isNearCurrentPrice
                    ? 'bg-amber-500/10 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                    : isHolding
                    ? 'bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40'
                    : 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
                }`}
              >
                {/* Level Index & Price */}
                <div className="flex items-center gap-3 font-mono">
                  <span className="text-slate-500 font-bold w-6">#{lvl.levelIndex}</span>
                  <span className="text-white font-bold">${lvl.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>

                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  {isNearCurrentPrice && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] uppercase">
                      📍 PRECIO ACTUAL
                    </span>
                  )}

                  {isHolding ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 font-semibold text-[10px] border border-rose-500/30">
                      <ArrowUpRight className="w-3 h-3" />
                      ESPERANDO VENTA
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold text-[10px] border border-emerald-500/30">
                      <ArrowDownRight className="w-3 h-3" />
                      ESPERANDO COMPRA
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
