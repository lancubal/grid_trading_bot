'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  DollarSign,
  Activity,
  Award,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  getProfitPerformanceChartData,
  ProfitPerformanceSummary,
  ProfitPerformancePoint,
} from '@/lib/actions';

type TimeframeKey = '24h' | '7d' | '30d' | '90d' | 'all';
type ViewMode = 'REALIZED_PROFIT' | 'PORTFOLIO_EQUITY';

export function ProfitPerformanceChart() {
  const [timeframe, setTimeframe] = useState<TimeframeKey>('7d');
  const [viewMode, setViewMode] = useState<ViewMode>('REALIZED_PROFIT');
  const [data, setData] = useState<ProfitPerformanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<ProfitPerformancePoint | null>(null);

  const loadChartData = useCallback(async (tf: TimeframeKey) => {
    setIsLoading(true);
    try {
      const summary = await getProfitPerformanceChartData(tf);
      setData(summary);
      if (summary.points.length > 0) {
        setHoveredPoint(summary.points[summary.points.length - 1]);
      }
    } catch (err) {
      console.error('Error cargando gráfico de performance:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChartData(timeframe);
  }, [timeframe, loadChartData]);

  const points = data?.points || [];
  const activePoint = hoveredPoint || (points.length > 0 ? points[points.length - 1] : null);

  // Determinar los valores Y según el modo seleccionado
  const getYValue = (p: ProfitPerformancePoint, seriesType: 'bot' | 'hold') => {
    if (viewMode === 'REALIZED_PROFIT') {
      return seriesType === 'bot' ? p.botProfitNet : 0;
    }
    return seriesType === 'bot' ? p.botEquity : p.holdEquity;
  };

  // Min / Max Y para escalar el SVG dinámicamente con zoom adaptativo
  const allValues: number[] = [];
  points.forEach((p) => {
    if (viewMode === 'REALIZED_PROFIT') {
      allValues.push(p.botProfitNet);
    } else {
      allValues.push(p.botEquity);
      allValues.push(p.holdEquity);
    }
  });

  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100;

  // En modo PORTFOLIO_EQUITY no forzamos 0 en el piso para que la curva tenga zoom completo
  const minY = viewMode === 'REALIZED_PROFIT'
    ? Math.min(0, Math.floor(rawMin))
    : Math.floor(rawMin - Math.max(5, (rawMax - rawMin) * 0.05));

  const maxY = viewMode === 'REALIZED_PROFIT'
    ? Math.max(10, Math.ceil(rawMax * 1.05))
    : Math.ceil(rawMax + Math.max(5, (rawMax - rawMin) * 0.05));

  const rangeY = maxY - minY || 1;

  // Dimensiones del Chart Vectorial
  const width = 850;
  const height = 320;
  const paddingLeft = 70; // Espacio amplio para etiquetas del Eje Y
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 40; // Espacio amplio para etiquetas del Eje X
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (index: number) => {
    if (points.length <= 1) return paddingLeft;
    return paddingLeft + (index / (points.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    const norm = (val - minY) / rangeY;
    return height - paddingBottom - norm * chartHeight;
  };

  // Rutas SVG para Curva Bot
  const botPathD = points.length > 0
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(getYValue(p, 'bot'))}`).join(' ')
    : '';

  // Rutas SVG para Curva HODL (modo PORTFOLIO_EQUITY)
  const holdPathD = (viewMode === 'PORTFOLIO_EQUITY' && points.length > 0)
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.holdEquity)}`).join(' ')
    : '';

  const botAreaD = points.length > 0
    ? `${botPathD} L ${getX(points.length - 1)} ${height - paddingBottom} L ${paddingLeft} ${height - paddingBottom} Z`
    : '';

  // Generar 5 Niveles de Referencia para el Eje Y (Valores en $)
  const yTicksCount = 5;
  const yTicks = Array.from({ length: yTicksCount }).map((_, i) => {
    const val = minY + (rangeY / (yTicksCount - 1)) * i;
    return {
      val,
      y: getY(val),
      label: viewMode === 'REALIZED_PROFIT' ? `$${val.toFixed(2)}` : `$${Math.round(val)}`,
    };
  });

  // Helper para redondear etiquetas del Eje X a números redondos (ej. 16:00 o 07-28)
  const formatCleanDateLabel = (rawLabel: string, tf: TimeframeKey) => {
    const parts = rawLabel.split(' ');
    if (parts.length < 2) return rawLabel;
    const datePart = parts[0]; // "07-28"
    const timePart = parts[1]; // "16:44"
    const hourClean = `${timePart.split(':')[0]}:00`; // "16:00"

    if (tf === '24h') {
      return hourClean;
    }
    if (tf === '7d' || tf === '30d') {
      return datePart;
    }
    return `${datePart}`;
  };

  // Generar 5-6 Marcas de Referencia Limpias para el Eje X
  const xTicksCount = Math.min(6, points.length);
  const xTicks = points.length > 0
    ? Array.from({ length: xTicksCount }).map((_, i) => {
        const index = Math.floor((i / (xTicksCount - 1)) * (points.length - 1));
        const pt = points[index];
        return {
          x: getX(index),
          label: formatCleanDateLabel(pt.dateLabel, timeframe),
        };
      })
    : [];

  const initialCapitalStr = data?.initialInvestment
    ? `$${Math.round(data.initialInvestment).toLocaleString()}`
    : '$1,000';

  const timeframeLabel =
    timeframe === 'all'
      ? 'Histórico Completo'
      : `Últimos ${timeframe.toUpperCase()}`;

  return (
    <div className="glass-panel p-5 rounded-xl space-y-4 border border-slate-800 bg-slate-900/60 shadow-xl">
      {/* 1. Header con Selectores de Modo y Temporalidad */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Award className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide uppercase flex items-center gap-2">
              Curva de Profit Acumulado & Alpha Comparativo
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de Modo (Ganancia Realizada vs Patrimonio Total) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setViewMode('REALIZED_PROFIT')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200 ${
                viewMode === 'REALIZED_PROFIT'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ganancia Realizada ($ USD)
            </button>
            <button
              onClick={() => setViewMode('PORTFOLIO_EQUITY')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200 ${
                viewMode === 'PORTFOLIO_EQUITY'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Patrimonio Valorizado vs HODL
            </button>
          </div>

          {/* Selector de Temporalidad */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['24h', '7d', '30d', '90d', 'all'] as TimeframeKey[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all duration-200 ${
                  timeframe === tf
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Tarjetas KPI según el Modo Activo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{viewMode === 'REALIZED_PROFIT' ? `Ganancia Neta (${timeframeLabel})` : 'Alpha vs HODL'}</span>
            {viewMode === 'REALIZED_PROFIT' ? (
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            )}
          </div>
          <div className="text-lg font-mono font-bold text-emerald-400">
            {viewMode === 'REALIZED_PROFIT' ? (
              `+$${data?.latestBotProfitNet.toFixed(2) ?? '0.00'} USD`
            ) : (
              `${data && data.latestAlphaUsd >= 0 ? '+' : ''}$${data?.latestAlphaUsd.toFixed(2) ?? '0.00'} USD`
            )}
          </div>
          <p className="text-[10px] text-slate-400">
            {viewMode === 'REALIZED_PROFIT'
              ? `Efectivo neto acumulado en USDT (${timeframeLabel})`
              : `Ganancia extra vs haber dejado los ${initialCapitalStr} en HODL (${data && data.latestAlphaPercent >= 0 ? '+' : ''}${data?.latestAlphaPercent.toFixed(2)}%)`}
          </p>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Portafolio Bot</span>
            <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-lg font-mono font-bold text-cyan-300">
            ${data?.latestBotEquity.toFixed(2) ?? '2000.00'} USD
          </div>
          <p className="text-[10px] text-slate-400">USDT Disponible + BTC Valorizado Spot</p>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Benchmark HODL</span>
            <Layers className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-lg font-mono font-bold text-purple-300">
            ${data?.latestHoldEquity.toFixed(2) ?? '2000.00'} USD
          </div>
          <p className="text-[10px] text-slate-400">Valor si los {initialCapitalStr} estuvieran 100% en BTC</p>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Máximo Drawdown</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-lg font-mono font-bold text-rose-400">
            -{data?.maxDrawdownPercent.toFixed(2) ?? '0.00'}%
          </div>
          <p className="text-[10px] text-slate-400">
            Caída máxima respecto al pico de portafolio (-${data?.maxDrawdownUsd.toFixed(2)} USD)
          </p>
        </div>
      </div>

      {/* 3. Leyenda e Información del Punto Seleccionado */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-3 h-1 rounded-full ${
                viewMode === 'REALIZED_PROFIT' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-cyan-400 shadow-sm shadow-cyan-400/50'
              }`}
            />
            <span className="text-slate-200 font-medium">
              {viewMode === 'REALIZED_PROFIT' ? `Ganancia Realizada (${timeframeLabel})` : 'Curva Bot (Patrimonio Total)'}
            </span>
          </div>

          {viewMode === 'PORTFOLIO_EQUITY' && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 bg-purple-400 rounded-full border-b border-dashed border-purple-400" />
                <span className="text-purple-300 font-medium">Benchmark HODL (100% BTC)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-rose-500/25 border border-rose-500/50 rounded-sm" />
                <span className="text-rose-300 font-medium">Zona de Drawdown</span>
              </div>
            </>
          )}
        </div>

        {activePoint && (
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-300">
            <span>📅 {activePoint.dateLabel}</span>
            <span>BTC: ${activePoint.btcPrice.toFixed(2)}</span>
            <span className="text-emerald-400">Profit Flips: +${activePoint.botProfitNet.toFixed(2)}</span>
            {viewMode === 'PORTFOLIO_EQUITY' && (
              <>
                <span className="text-cyan-300">Portafolio: ${activePoint.botEquity.toFixed(2)}</span>
                <span className="text-purple-300">HODL: ${activePoint.holdEquity.toFixed(2)}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 4. Gráfico Vectorial SVG con Ejes y Escala de Referencia */}
      <div className="relative w-full h-[320px] bg-slate-950 rounded-lg overflow-hidden border border-slate-800/80 p-2">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-20">
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono">
              <Activity className="w-4 h-4 animate-spin" />
              Calculando Ejes en Backend...
            </div>
          </div>
        ) : points.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs">
            Sin datos de ejecuciones históricas para la temporalidad seleccionada.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full overflow-visible"
            onMouseLeave={() => setHoveredPoint(points[points.length - 1])}
          >
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={viewMode === 'REALIZED_PROFIT' ? '#10b981' : '#06b6d4'}
                  stopOpacity="0.30"
                />
                <stop
                  offset="100%"
                  stopColor={viewMode === 'REALIZED_PROFIT' ? '#10b981' : '#06b6d4'}
                  stopOpacity="0.0"
                />
              </linearGradient>
            </defs>

            {/* --- EJE Y: Líneas de Guía Horizontal y Textos de Escala ($ USD) --- */}
            {yTicks.map((tick, idx) => (
              <g key={`y-grid-${idx}`}>
                <line
                  x1={paddingLeft}
                  y1={tick.y}
                  x2={width - paddingRight}
                  y2={tick.y}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 10}
                  y={tick.y + 4}
                  fill="#94a3b8"
                  fontSize="11"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* --- EJE X: Guías Verticales y Textos de Fecha/Hora Redondos --- */}
            {xTicks.map((tick, idx) => (
              <g key={`x-grid-${idx}`}>
                <line
                  x1={tick.x}
                  y1={paddingTop}
                  x2={tick.x}
                  y2={height - paddingBottom}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={tick.x}
                  y={height - 12}
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Línea Base de Eje (Eje X principal en el piso) */}
            <line
              x1={paddingLeft}
              y1={height - paddingBottom}
              x2={width - paddingRight}
              y2={height - paddingBottom}
              stroke="#334155"
              strokeWidth="1.5"
            />

            {/* Línea Base del Eje Y principal (Izquierda) */}
            <line
              x1={paddingLeft}
              y1={paddingTop}
              x2={paddingLeft}
              y2={height - paddingBottom}
              stroke="#334155"
              strokeWidth="1.5"
            />

            {/* Zonas de Drawdown (visibles únicamente en modo PORTFOLIO_EQUITY) */}
            {viewMode === 'PORTFOLIO_EQUITY' &&
              points.map((p, i) => {
                if (!p.isDrawdown) return null;
                const x1 = getX(i);
                const x2 = i < points.length - 1 ? getX(i + 1) : x1 + 5;
                const yPeak = getY(p.highWaterMark);
                const yBot = getY(p.botEquity);

                return (
                  <rect
                    key={`dd-${i}`}
                    x={x1}
                    y={yPeak}
                    width={Math.max(1, x2 - x1)}
                    height={Math.max(1, yBot - yPeak)}
                    fill="rgba(239, 68, 68, 0.20)"
                    stroke="rgba(239, 68, 68, 0.35)"
                    strokeWidth="0.5"
                  />
                );
              })}

            {/* Relleno Degradado bajo la Curva Principal */}
            {botAreaD && <path d={botAreaD} fill="url(#profitGradient)" />}

            {/* Curva HODL Benchmark (Línea Morada Punteada - modo PORTFOLIO_EQUITY) */}
            {holdPathD && (
              <path
                d={holdPathD}
                fill="none"
                stroke="#a855f7"
                strokeWidth="2"
                strokeDasharray="5 5"
                strokeLinecap="round"
              />
            )}

            {/* Curva Bot Principal */}
            {botPathD && (
              <path
                d={botPathD}
                fill="none"
                stroke={viewMode === 'REALIZED_PROFIT' ? '#10b981' : '#06b6d4'}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Puntos de Interacción al pasar el cursor */}
            {points.map((p, i) => {
              const cx = getX(i);
              const cy = getY(getYValue(p, 'bot'));
              const isHovered = hoveredPoint?.timestamp === p.timestamp;

              return (
                <g key={`pt-${i}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHovered ? '5' : '3'}
                    className={`transition-all duration-150 cursor-pointer ${
                      viewMode === 'REALIZED_PROFIT'
                        ? isHovered
                          ? 'fill-emerald-300 stroke-emerald-500 stroke-2'
                          : 'fill-emerald-400 opacity-60 hover:opacity-100'
                        : isHovered
                        ? 'fill-cyan-300 stroke-cyan-500 stroke-2'
                        : 'fill-cyan-400 opacity-60 hover:opacity-100'
                    }`}
                    onMouseEnter={() => setHoveredPoint(p)}
                  />
                  <rect
                    x={cx - 10}
                    y={paddingTop}
                    width={20}
                    height={chartHeight}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPoint(p)}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
