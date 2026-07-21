'use client';

import React, { useState } from 'react';
import { History, ArrowUpRight, ArrowDownRight, Filter } from 'lucide-react';

interface FlipItem {
  id: string;
  exchangeId: string;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  fee: number;
  netGain: number;
  gridLevelIndex: number;
  updatedAt: string;
}

interface FlipsHistoryTableProps {
  flips: FlipItem[];
}

export function FlipsHistoryTable({ flips }: FlipsHistoryTableProps) {
  const [filterPeriod, setFilterPeriod] = useState<'7d' | '30d' | 'all'>('all');

  const filteredFlips = flips.filter((f) => {
    if (filterPeriod === 'all') return true;
    const diffDays = (Date.now() - new Date(f.updatedAt).getTime()) / (1000 * 3600 * 24);
    if (filterPeriod === '7d') return diffDays <= 7;
    if (filterPeriod === '30d') return diffDays <= 30;
    return true;
  });

  return (
    <div className="glass-panel p-4 rounded-xl space-y-4">
      {/* Header Tabla */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">
            Historial de Flips Completados (Ejecuciones)
          </h3>
        </div>

        {/* Filtro Rápido */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-slate-800/80 border border-slate-700 text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400 ml-1" />
          <button
            onClick={() => setFilterPeriod('7d')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              filterPeriod === '7d' ? 'bg-cyan-500 text-black font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            7 Días
          </button>
          <button
            onClick={() => setFilterPeriod('30d')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              filterPeriod === '30d' ? 'bg-cyan-500 text-black font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            30 Días
          </button>
          <button
            onClick={() => setFilterPeriod('all')}
            className={`px-2.5 py-1 rounded font-medium transition-all ${
              filterPeriod === 'all' ? 'bg-cyan-500 text-black font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Histórico Completo
          </button>
        </div>
      </div>

      {/* Tabla Flips */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-3">ID Flip / Order</th>
              <th className="py-2.5 px-3">Fecha & Hora</th>
              <th className="py-2.5 px-3">Nivel Grilla</th>
              <th className="py-2.5 px-3">Operación</th>
              <th className="py-2.5 px-3">Precio Ejecutado</th>
              <th className="py-2.5 px-3">Monto (BTC)</th>
              <th className="py-2.5 px-3">Maker Fee (USD)</th>
              <th className="py-2.5 px-3 text-right">Ganancia Neta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filteredFlips.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-500">
                  No hay ejecuciones registradas para el período seleccionado.
                </td>
              </tr>
            ) : (
              filteredFlips.map((flip) => {
                const isBuy = flip.side === 'BUY';
                return (
                  <tr key={flip.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3 text-slate-300 font-bold">{flip.exchangeId}</td>
                    <td className="py-2.5 px-3 text-slate-400">
                      {new Date(flip.updatedAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-cyan-400 font-bold">#{flip.gridLevelIndex}</td>
                    <td className="py-2.5 px-3">
                      {isBuy ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                          <ArrowDownRight className="w-3.5 h-3.5" /> COMPRA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                          <ArrowUpRight className="w-3.5 h-3.5" /> VENTA
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-white font-bold">${flip.price.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-slate-300">{flip.amount.toFixed(4)} BTC</td>
                    <td className="py-2.5 px-3 text-amber-400">${flip.fee.toFixed(4)}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                      +${flip.netGain.toFixed(4)} USD
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
