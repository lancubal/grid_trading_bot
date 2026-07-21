'use client';

import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';

interface GridLevelItem {
  id: string;
  levelIndex: number;
  price: number;
  isHolding: boolean;
}

interface TradingViewChartProps {
  gridLevels: GridLevelItem[];
  onPriceUpdate: (price: number) => void;
}

export function TradingViewChart({ gridLevels, onPriceUpdate }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Inicializar Gráfico TradingView Lightweight Charts
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 480,
      layout: {
        background: { color: '#090D16' },
        textColor: '#94A3B8',
      },
      grid: {
        vertLines: { color: '#1E293B' },
        horzLines: { color: '#1E293B' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

    // Cargar velas iniciales de fallback (Binance REST)
    fetch('https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=100')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const formatted = data.map((c: any) => ({
            time: Math.floor(c[0] / 1000) as any,
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
          }));
          candlestickSeries.setData(formatted);
          if (formatted.length > 0) {
            onPriceUpdate(formatted[formatted.length - 1].close);
          }
        }
      })
      .catch((err) => console.warn('Klines fetch warning:', err));

    // 2. Conectar a Binance WebSocket (1m kline) a costo cero
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.e === 'kline') {
          const k = message.k;
          const candle = {
            time: Math.floor(k.t / 1000) as any,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          };
          candlestickSeries.update(candle);
          onPriceUpdate(candle.close);
        }
      } catch (err) {
        console.error('WS parsing error:', err);
      }
    };

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      chart.remove();
    };
  }, []);

  // 3. Superponer / Actualizar las 15 Líneas Horizontal de Grilla (Price Lines)
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    // Remover líneas anteriores
    priceLinesRef.current.forEach((line) => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch (e) {}
    });
    priceLinesRef.current = [];

    // Dibujar 15 niveles de grilla
    gridLevels.forEach((level) => {
      const isHolding = level.isHolding;
      const color = isHolding ? '#EF4444' : '#10B981'; // Rojo si esperando venta, Verde si esperando compra
      const title = isHolding ? `VENTA #${level.levelIndex}` : `COMPRA #${level.levelIndex}`;

      const priceLine = candlestickSeriesRef.current?.createPriceLine({
        price: level.price,
        color,
        lineWidth: isHolding ? 2 : 1,
        lineStyle: isHolding ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title,
      });

      if (priceLine) {
        priceLinesRef.current.push(priceLine);
      }
    });
  }, [gridLevels]);

  return (
    <div className="glass-panel p-4 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">
            Gráfico en Vivo BTC/USDT (Velas 1m + Superposición Grilla)
          </h3>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-400 border-b border-dashed border-emerald-400" />
            <span className="text-slate-300">Esperando Compra (Línea Verde)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-rose-400" />
            <span className="text-slate-300">Esperando Venta (Línea Roja)</span>
          </div>
        </div>
      </div>

      <div ref={chartContainerRef} className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-800" />
    </div>
  );
}
