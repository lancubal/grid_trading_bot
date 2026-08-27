'use client';

import React from 'react';
import { LegacyVaultData, DepthDomLevel } from '@/lib/actions';
import { ShieldCheck, Compass, Lock, Zap, ArrowRight, ShieldAlert } from 'lucide-react';

interface StructuralWorkspaceProps {
  legacyVault: LegacyVaultData;
  macroOrders: DepthDomLevel[];
  currentSpotPrice: number;
}

export function StructuralWorkspace({ legacyVault, macroOrders, currentSpotPrice }: StructuralWorkspaceProps) {
  const { totalLegacyOrders, totalFrozenBtc, totalFrozenUsd, avgRescuePct, orders } = legacyVault;

  const macroSells = macroOrders.filter((o) => o.side === 'SELL');
  const macroBuys = macroOrders.filter((o) => o.side === 'BUY');

  const nextMacroSell = macroSells[macroSells.length - 1];
  const nextMacroBuy = macroBuys[0];

  const distToSell = nextMacroSell ? nextMacroSell.price - currentSpotPrice : 850;
  const distToBuy = nextMacroBuy ? currentSpotPrice - nextMacroBuy.price : 850;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* 1. EL ESTRATO GEOLÓGICO LEGACY */}
      <div className="lg:col-span-7 glass-panel p-4 rounded-xl border border-slate-800 bg-slate-950/80 shadow-xl flex flex-col justify-between">
        <div className="flex items-center justify-between pb-2 border-b border-slate-900">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Estrato Geológico: Bóveda Legacy
            </h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-semibold">
            {totalLegacyOrders > 0 ? `${totalLegacyOrders} Órdenes Protegidas` : 'Bóveda Despejada (100% Activo)'}
          </span>
        </div>

        <div className="my-3 space-y-3">
          {orders.length === 0 ? (
            <div className="p-6 rounded-xl border border-emerald-900/30 bg-emerald-950/10 flex flex-col items-center justify-center text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p className="font-mono text-xs font-bold text-emerald-300">
                ¡Sin Inventario Atrapado en la Bóveda!
              </p>
              <p className="font-mono text-[11px] text-slate-400 max-w-md">
                Todo tu capital está inyectado 100% en la grilla dinámica activa generando rotación continua sin órdenes rezagadas.
              </p>
            </div>
          ) : (
            orders.map((ord) => {
              const isClose = ord.rescuePct >= 95;
              return (
                <div
                  key={ord.id}
                  className="p-3 rounded-lg border border-slate-900 bg-slate-900/50 space-y-2 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-bold text-white">Target: ${ord.price.toFixed(2)} USD</span>
                      <span className="text-[10px] text-slate-500">({ord.dateArchived})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400 font-bold">{ord.rescuePct}%</span>
                      <span className="text-[10px] text-slate-400">
                        (Faltan +${ord.distUsd.toFixed(0)} USD)
                      </span>
                    </div>
                  </div>

                  {/* TERMÓMETRO DE RESCATE HORIZONTAL */}
                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 relative">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${
                        isClose
                          ? 'bg-gradient-to-r from-amber-500 to-emerald-400 animate-pulse'
                          : 'bg-gradient-to-r from-amber-600 to-amber-400'
                      }`}
                      style={{ width: `${ord.rescuePct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Inventario: {ord.amount.toFixed(4)} BTC (${ord.totalUsd.toFixed(1)} USD)</span>
                    <span className="text-emerald-400">Take-Profit 1.8x Programado</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>Capital en Bóveda: <strong className="text-white">${totalFrozenUsd.toFixed(1)} USD</strong></span>
          <span className="text-emerald-400">Cero Venta a Pérdida Garantizada</span>
        </div>
      </div>

      {/* 2. RADAR MACRO DE PROXIMIDAD (75% DEL CAPITAL) */}
      <div className="lg:col-span-5 glass-panel p-4 rounded-xl border border-slate-800 bg-slate-950/80 shadow-xl flex flex-col justify-between">
        <div className="flex items-center justify-between pb-2 border-b border-slate-900">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Radar Macro (Músculo 75%)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-cyan-400">
            Escalón: $874.50 USD
          </span>
        </div>

        <div className="my-4 space-y-4 font-mono text-xs">
          {/* PRÓXIMA VENTA MACRO */}
          <div className="p-3.5 rounded-xl border border-red-900/30 bg-red-950/20 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">
                Próximo Disparo de Venta Swing
              </span>
              <p className="text-base font-black text-white">
                {nextMacroSell ? `$${nextMacroSell.price.toFixed(2)}` : '$79,508.50 USD'}
              </p>
            </div>
            <div className="text-right space-y-0.5">
              <span className="text-red-400 font-bold text-sm">+{distToSell.toFixed(0)} USD</span>
              <p className="text-[10px] text-slate-400">
                +{((distToSell / currentSpotPrice) * 100).toFixed(2)}% del precio
              </p>
            </div>
          </div>

          {/* PRÓXIMA COMPRA MACRO */}
          <div className="p-3.5 rounded-xl border border-emerald-900/30 bg-emerald-950/20 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                Próximo Bloque de Compra Swing
              </span>
              <p className="text-base font-black text-white">
                {nextMacroBuy ? `$${nextMacroBuy.price.toFixed(2)}` : '$76,010.50 USD'}
              </p>
            </div>
            <div className="text-right space-y-0.5">
              <span className="text-emerald-400 font-bold text-sm">-{distToBuy.toFixed(0)} USD</span>
              <p className="text-[10px] text-slate-400">
                -{((distToBuy / currentSpotPrice) * 100).toFixed(2)}% del precio
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>Tickets Macro: <strong className="text-white">~$300 - $388 USD</strong></span>
          <span className="text-cyan-400">75% Capital Activo</span>
        </div>
      </div>
    </div>
  );
}
