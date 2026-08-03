'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import { Layers, Eye, ZoomIn, ZoomOut } from 'lucide-react';

interface GridLevelItem {
  id: string;
  levelIndex: number;
  price: number;
  isHolding: boolean;
  activeOrder?: {
    id: string;
    side: 'BUY' | 'SELL';
    amount: number;
  } | null;
}

interface TradingViewChartProps {
  gridLevels: GridLevelItem[];
  onPriceUpdate: (price: number) => void;
}

type LodMode = 'AUTO' | 'CHANNEL' | 'DETAILED';

export function TradingViewChart({ gridLevels, onPriceUpdate }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);

  const [lodMode, setLodMode] = useState<LodMode>('AUTO');
  const [currentZoomLevel, setCurrentZoomLevel] = useState<'ZOOMED_IN' | 'ZOOMED_OUT'>('ZOOMED_OUT');
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);

  // Re-dibujar líneas de grilla según el Nivel de Detalle (LOD)
  const renderGridLines = useCallback(() => {
    if (!candlestickSeriesRef.current || gridLevels.length === 0) return;

    // 1. Limpiar líneas anteriores
    priceLinesRef.current.forEach((line) => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch (e) {}
    });
    priceLinesRef.current = [];

    // Calcular min/max y promedios para Zonas
    const sortedLevels = [...gridLevels].sort((a, b) => a.price - b.price);
    const minPrice = sortedLevels[0].price;
    const maxPrice = sortedLevels[sortedLevels.length - 1].price;

    const sellLevels = sortedLevels.filter((l) => l.isHolding || l.activeOrder?.side === 'SELL');
    const buyLevels = sortedLevels.filter((l) => !l.isHolding || l.activeOrder?.side === 'BUY');

    const shouldShowChannelOnly =
      lodMode === 'CHANNEL' || (lodMode === 'AUTO' && currentZoomLevel === 'ZOOMED_OUT');

    if (shouldShowChannelOnly) {
      // --- MODO CANAL RESUMIDO (Zoom Alejado: evita efecto código de barras) ---
      // Linea Techo Máximo
      const topBoundary = candlestickSeriesRef.current.createPriceLine({
        price: maxPrice,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `TECHO GRILLA ($${maxPrice.toFixed(0)})`,
      });
      priceLinesRef.current.push(topBoundary);

      // Linea Piso Mínimo
      const bottomBoundary = candlestickSeriesRef.current.createPriceLine({
        price: minPrice,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `PISO GRILLA ($${minPrice.toFixed(0)})`,
      });
      priceLinesRef.current.push(bottomBoundary);

      // Zona Promedio Venta
      if (sellLevels.length > 0) {
        const avgSell = sellLevels.reduce((acc, l) => acc + l.price, 0) / sellLevels.length;
        const sellZoneLine = candlestickSeriesRef.current.createPriceLine({
          price: avgSell,
          color: 'rgba(239, 68, 68, 0.75)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `ZONA DE VENTA (${sellLevels.length} Órdenes)`,
        });
        priceLinesRef.current.push(sellZoneLine);
      }

      // Zona Promedio Compra
      if (buyLevels.length > 0) {
        const avgBuy = buyLevels.reduce((acc, l) => acc + l.price, 0) / buyLevels.length;
        const buyZoneLine = candlestickSeriesRef.current.createPriceLine({
          price: avgBuy,
          color: 'rgba(16, 185, 129, 0.75)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `ZONA DE COMPRA (${buyLevels.length} Órdenes)`,
        });
        priceLinesRef.current.push(buyZoneLine);
      }
    } else {
      // --- MODO DETALLADO (Zoom Cercano: Jerarquía de opacidad individual) ---
      gridLevels.forEach((level) => {
        const isActiveOrder = Boolean(level.activeOrder);
        const isHolding = level.isHolding;

        let color = '#475569'; // Gris fantasma para inactivas/históricas
        let lineWidth = 1;
        let lineStyle = LineStyle.Dotted;
        let axisLabelVisible = false;

        if (isActiveOrder || isHolding) {
          // Órdenes VIVAS esperándose en Binance: Colores sólidos y brillantes
          if (isHolding || level.activeOrder?.side === 'SELL') {
            color = '#ef4444'; // Rojo brillante Venta
          } else {
            color = '#10b981'; // Verde brillante Compra
          }
          lineWidth = 2;
          lineStyle = LineStyle.Solid;
          axisLabelVisible = true;
        }

        const title = isActiveOrder
          ? `${level.activeOrder?.side === 'SELL' ? 'VENTA' : 'COMPRA'} #${level.levelIndex}`
          : isHolding
          ? `VENTA #${level.levelIndex}`
          : `#${level.levelIndex}`;

        const priceLine = candlestickSeriesRef.current?.createPriceLine({
          price: level.price,
          color,
          lineWidth,
          lineStyle,
          axisLabelVisible,
          title,
        });

        if (priceLine) {
          priceLinesRef.current.push(priceLine);
        }
      });
    }
  }, [gridLevels, lodMode, currentZoomLevel]);

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

    // Detectar Zoom para cambiar automáticamente entre Canal Resumido y Escalones Detallados
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const barsCount = range.to - range.from;
      // Si se están viendo más de 45 velas (zoom alejado), activar modo CANAL
      if (barsCount > 45) {
        setCurrentZoomLevel('ZOOMED_OUT');
      } else {
        setCurrentZoomLevel('ZOOMED_IN');
      }
    });

    // Cargar velas iniciales (Binance REST API)
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

    // Conectar a Binance WebSocket (1m kline)
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
  }, [onPriceUpdate]);

  // Actualizar líneas cuando cambie la grilla o la configuración LOD
  useEffect(() => {
    renderGridLines();

    const activeCount = gridLevels.filter((g) => g.activeOrder || g.isHolding).length;
    setActiveOrdersCount(activeCount);
  }, [gridLevels, renderGridLines]);

  return (
    <div className="glass-panel p-4 rounded-xl space-y-3 border border-slate-800 bg-slate-900/60 shadow-xl">
      {/* Header con Control de Renderizado por Nivel de Detalle (LOD) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <h3 className="text-sm font-bold tracking-wide text-white uppercase flex items-center gap-2">
            Gráfico en Vivo BTC/USDT (LOD & Jerarquía de Opacidad)
          </h3>
        </div>

        {/* Controles de Modo LOD (Auto / Canal / Detallado) */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setLodMode('AUTO')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                lodMode === 'AUTO'
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3 h-3" />
              LOD Auto
            </button>
            <button
              onClick={() => setLodMode('CHANNEL')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                lodMode === 'CHANNEL'
                  ? 'bg-slate-800 text-purple-400 border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ZoomOut className="w-3 h-3" />
              Canal Resumido
            </button>
            <button
              onClick={() => setLodMode('DETAILED')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                lodMode === 'DETAILED'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ZoomIn className="w-3 h-3" />
              Ver Escalones
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-[11px] bg-slate-950/60 px-3 py-1 rounded-lg border border-slate-800 font-mono text-slate-300">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Órdenes Vivas: {activeOrdersCount}
            </span>
            <span className="text-slate-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              Fantasmas: {gridLevels.length - activeOrdersCount}
            </span>
          </div>
        </div>
      </div>

      {/* Contenedor Principal del Gráfico */}
      <div ref={chartContainerRef} className="w-full h-[480px] rounded-lg overflow-hidden border border-slate-800" />
    </div>
  );
}
