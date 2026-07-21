'use client';

import React, { useState, useEffect } from 'react';
import { Terminal, Zap, ShieldCheck } from 'lucide-react';

export function ConsoleLogs() {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const initialLogs = [
      `[${new Date().toLocaleTimeString()}] 🟢 Bot de Grid Trading iniciado en AWS EC2 (Modo Shadow Trading Active)`,
      `[${new Date().toLocaleTimeString()}] 📡 Monitoreo de volatilidad en vivo para BTC/USDT (Timeframe 1h, ATR-14)`,
      `[${new Date().toLocaleTimeString()}] 📊 ATR Inicial registrado: $283.68 USD. Rango de grilla adaptado a $1,500.00 USD`,
      `[${new Date().toLocaleTimeString()}] 📥 14 órdenes de siembra iniciales interceptadas con UUID v4 en PostgreSQL`,
      `[${new Date().toLocaleTimeString()}] ⚡ Local Matching Engine activo: comparando ticks de Binance contra base de datos`,
    ];
    setLogs(initialLogs);

    const timer = setInterval(() => {
      const time = new Date().toLocaleTimeString();
      const mockEvents = [
        `[${time}] 📊 Tick de precio de mercado verificado: $66,662.00 USD (Dentro de la grilla)`,
        `[${time}] ⚡ ATR Evaluado (1h): $284.10 USD (Variación sub-15%: Sin necesidad de re-balanceo)`,
        `[${time}] 🛡️ RiskGuard: Estado de salud del bot nominal (15 órdenes abiertas intactas)`,
      ];
      const randomEvent = mockEvents[Math.floor(Math.random() * mockEvents.length)];
      setLogs((prev) => [randomEvent, ...prev.slice(0, 19)]);
    }, 15000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="glass-panel p-4 rounded-xl space-y-3 font-mono">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">
            Logs del Motor & Volatilidad ATR (Terminal Consola)
          </h3>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" /> Normal
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <Zap className="w-3.5 h-3.5" /> ATR Auto-Tune
          </span>
        </div>
      </div>

      <div className="bg-slate-950 p-3 rounded-lg border border-slate-850 max-h-[160px] overflow-y-auto space-y-1 text-xs text-slate-300">
        {logs.map((log, index) => (
          <div key={index} className="flex items-start gap-2 hover:bg-slate-900/50 p-0.5 rounded">
            <span className="text-purple-400 select-none">&gt;</span>
            <span>{log}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
