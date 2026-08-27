'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle, LineWidth, SeriesMarker } from 'lightweight-charts';
import { Clock, LineChart, CandlestickChart, ShieldCheck, Zap } from 'lucide-react';
import { TimelineTradeMarker } from '@/lib/actions';

interface TimelineTradeChartProps {
  markers: TimelineTradeMarker[];
  atrFloor?: number;
  atrCeiling?: number;
  currentSpotPrice: number;
  onPriceUpdate: (price: number) => void;
}

type CandleInterval = '1m' | '5m' | '15m' | '1h';
type ChartMode = 'TIMELINE' | 'CANDLES';

export function TimelineTradeChart({
  markers,
  atrFloor = 75000,
  atrCeiling = 82000,
  currentSpotPrice,
  onPriceUpdate,
}: TimelineTradeChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const currentPriceLineRef = useRef<any>(null);
  const atrFloorLineRef = useRef<any>(null);
  const atrCeilingLineRef = useRef<any>(null);

  const [chartMode, setChartMode] = useState<ChartMode>('TIMELINE');
  const [interval, setInterval] = useState<CandleInterval>('15m');
  const [hoveredMarker, setHoveredMarker] = useState<TimelineTradeMarker | null>(null);

  const updateCurrentPrice = useCallback((price: number) => {
    const series = chartMode === 'TIMELINE' ? areaSeriesRef.current : candlestickSeriesRef.current;
    if (!series) return;

    try {
      if (!currentPriceLineRef.current) {
        currentPriceLineRef.current = series.createPriceLine({
          price,
          color: '#fbbf24',
          lineWidth: 2 as LineWidth,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'SPOT',
        });
      } else {
        currentPriceLineRef.current.applyOptions({ price });
      }
    } catch {}
  }, [chartMode]);

  // Descargar velas históricas y configurar series
  const fetchChartData = useCallback((intvl: CandleInterval) => {
    fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${intvl}&limit=600`)
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return;

        const formattedCandles = data.map((c: any) => ({
          time: Math.floor(c[0] / 1000) as any,
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
        }));

        const formattedLine = formattedCandles.map((c) => ({
          time: c.time,
          value: c.close,
        }));

        if (areaSeriesRef.current) {
          areaSeriesRef.current.setData(formattedLine);
        }
        if (candlestickSeriesRef.current) {
          candlestickSeriesRef.current.setData(formattedCandles);
        }

        if (formattedCandles.length > 0) {
          const lastClose = formattedCandles[formattedCandles.length - 1].close;
          updateCurrentPrice(lastClose);
          onPriceUpdate(lastClose);
        }

        // Aplicar marcadores de trades a la serie de línea
        if (areaSeriesRef.current && markers.length > 0) {
          const seriesMarkers: SeriesMarker<any>[] = markers
            .filter((m) => m.time >= formattedLine[0]?.time)
            .map((m) => ({
              time: m.time as any,
              position: m.side === 'BUY' ? 'belowBar' : 'aboveBar',
              color: m.side === 'BUY' ? '#10B981' : '#F59E0B',
              shape: m.side === 'BUY' ? 'arrowUp' : 'arrowDown',
              text: m.side === 'BUY' ? `BUY $${m.price.toFixed(0)}` : `SELL +$${m.profitUsd?.toFixed(1) || '0'}`,
              size: m.layer === 'MACRO' ? 2 : 1,
            }));

          // Ordenar marcadores por tiempo
          seriesMarkers.sort((a, b) => (a.time as number) - (b.time as number));
          areaSeriesRef.current.setMarkers(seriesMarkers);
        }
      })
      .catch((err) => console.warn('Error fetching klines:', err));
  }, [markers, onPriceUpdate, updateCurrentPrice]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 440,
      layout: {
        background: { color: '#090D16' },
        textColor: '#94A3B8',
      },
      grid: {
        vertLines: { color: '#111827' },
        horzLines: { color: '#111827' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#1E293B',
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const areaSeries = chart.addAreaSeries({
      topColor: 'rgba(56, 189, 248, 0.45)',
      bottomColor: 'rgba(56, 189, 248, 0.02)',
      lineColor: '#38BDF8',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Líneas de Canal ATR Iluminado
    atrCeilingLineRef.current = areaSeries.createPriceLine({
      price: atrCeiling,
      color: 'rgba(239, 68, 68, 0.65)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `TECHO ATR ($${atrCeiling.toFixed(0)})`,
    });

    atrFloorLineRef.current = areaSeries.createPriceLine({
      price: atrFloor,
      color: 'rgba(16, 185, 129, 0.65)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `PISO ATR ($${atrFloor.toFixed(0)})`,
    });

    chartRef.current = chart;
    areaSeriesRef.current = areaSeries;
    candlestickSeriesRef.current = candleSeries;

    // Toggle de visibilidad según modo
    if (chartMode === 'TIMELINE') {
      candleSeries.applyOptions({ visible: false });
      areaSeries.applyOptions({ visible: true });
    } else {
      areaSeries.applyOptions({ visible: false });
      candleSeries.applyOptions({ visible: true });
    }

    fetchChartData(interval);

    // WebSocket Binance Live Feed
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e === 'kline') {
          const k = msg.k;
          const close = parseFloat(k.c);
          const t = Math.floor(k.t / 1000) as any;

          if (areaSeriesRef.current) {
            areaSeriesRef.current.update({ time: t, value: close });
          }
          if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.update({
              time: t,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close,
            });
          }
          updateCurrentPrice(close);
          onPriceUpdate(close);
        }
      } catch {}
    };

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      chart.remove();
    };
  }, [chartMode, fetchChartData, interval, onPriceUpdate, updateCurrentPrice, atrCeiling, atrFloor]);

  const handleModeChange = (mode: ChartMode) => {
    setChartMode(mode);
    if (areaSeriesRef.current && candlestickSeriesRef.current) {
      if (mode === 'TIMELINE') {
        candlestickSeriesRef.current.applyOptions({ visible: false });
        areaSeriesRef.current.applyOptions({ visible: true });
      } else {
        areaSeriesRef.current.applyOptions({ visible: false });
        candlestickSeriesRef.current.applyOptions({ visible: true });
      }
    }
  };

  return (
    <div className="glass-panel p-4 rounded-xl border border-slate-800 bg-slate-950/80 shadow-2xl space-y-3">
      {/* Controles Superiores: Modo de Gráfico, Temporalidad y Canal ATR */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => handleModeChange('TIMELINE')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
                chartMode === 'TIMELINE'
                  ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LineChart className="w-3.5 h-3.5" />
              Línea de Tiempo & Trades
            </button>
            <button
              onClick={() => handleModeChange('CANDLES')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all ${
                chartMode === 'CANDLES'
                  ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <CandlestickChart className="w-3.5 h-3.5" />
              Velas TradingView
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-cyan-950/40 border border-cyan-800/40 rounded-lg text-xs font-mono text-cyan-300">
            <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>Canal ATR: ${atrFloor.toFixed(0)} - ${atrCeiling.toFixed(0)}</span>
          </div>
        </div>

        {/* Temporalidad y Marcadores */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <Clock className="w-3.5 h-3.5 text-slate-400 ml-1" />
            {(['1m', '5m', '15m', '1h'] as CandleInterval[]).map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  setInterval(tf);
                  fetchChartData(tf);
                }}
                className={`px-2 py-0.5 rounded text-xs font-mono font-semibold transition-all ${
                  interval === tf
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-slate-900/90 px-3 py-1 rounded-lg border border-slate-800 font-mono text-[11px]">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Compras: {markers.filter((m) => m.side === 'BUY').length}
            </span>
            <span className="text-amber-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Flips TP: {markers.filter((m) => m.side === 'SELL').length}
            </span>
          </div>
        </div>
      </div>

      {/* Contenedor del Gráfico */}
      <div
        ref={chartContainerRef}
        className="w-full h-[440px] rounded-lg overflow-hidden border border-slate-900 cursor-crosshair"
      />
    </div>
  );
}
