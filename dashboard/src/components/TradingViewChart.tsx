'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle, LineWidth } from 'lightweight-charts';
import { Eye, ZoomIn, ZoomOut, Clock } from 'lucide-react';

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
type CandleInterval = '1m' | '5m' | '15m' | '1h';

export function TradingViewChart({ gridLevels, onPriceUpdate }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const currentPriceLineRef = useRef<any>(null);

  // Ref estable para evitar re-inicializaciones del gráfico en re-renders del padre
  const onPriceUpdateRef = useRef(onPriceUpdate);
  useEffect(() => {
    onPriceUpdateRef.current = onPriceUpdate;
  });

  const [lodMode, setLodMode] = useState<LodMode>('AUTO');
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('1m');
  const [currentZoomLevel, setCurrentZoomLevel] = useState<'ZOOMED_IN' | 'ZOOMED_OUT'>('ZOOMED_OUT');
  const zoomLevelRef = useRef<'ZOOMED_IN' | 'ZOOMED_OUT'>('ZOOMED_OUT');
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);
  const [lastSpotPrice, setLastSpotPrice] = useState<number | null>(null);

  // Actualizar o crear la línea de Precio Actual en color Amarillo Ámbar brillante
  const updateCurrentPriceLine = useCallback((price: number) => {
    setLastSpotPrice(price);
    const series = candlestickSeriesRef.current;
    if (!series) return;

    try {
      if (!currentPriceLineRef.current) {
        currentPriceLineRef.current = series.createPriceLine({
          price,
          color: '#fbbf24', // Amarillo Ámbar vibrante
          lineWidth: 2 as LineWidth,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, // Badge resplandeciente en la barra de escala a la derecha
          title: 'PRECIO ACTUAL',
        });
      } else {
        currentPriceLineRef.current.applyOptions({
          price,
        });
      }
    } catch (err) {
      console.warn('Advertencia actualizando línea de precio actual:', err);
    }
  }, []);

  // Re-dibujar líneas de grilla según el Nivel de Detalle (LOD) de manera asíncrona segura
  const renderGridLines = useCallback(() => {
    requestAnimationFrame(() => {
      const series = candlestickSeriesRef.current;
      if (!series || gridLevels.length === 0) return;

      // 1. Limpiar líneas anteriores con verificación estricta de seguridad
      if (priceLinesRef.current.length > 0) {
        priceLinesRef.current.forEach((line) => {
          try {
            series.removePriceLine(line);
          } catch (e) {}
        });
        priceLinesRef.current = [];
      }

      // Calcular min/max y promedios para Zonas
      const sortedLevels = [...gridLevels].sort((a, b) => a.price - b.price);
      const minPrice = sortedLevels[0].price;
      const maxPrice = sortedLevels[sortedLevels.length - 1].price;

      const sellLevels = sortedLevels.filter((l) => l.isHolding || l.activeOrder?.side === 'SELL');
      const buyLevels = sortedLevels.filter((l) => !l.isHolding || l.activeOrder?.side === 'BUY');

      const shouldShowChannelOnly =
        lodMode === 'CHANNEL' || (lodMode === 'AUTO' && currentZoomLevel === 'ZOOMED_OUT');

      try {
        if (shouldShowChannelOnly) {
          // --- MODO CANAL RESUMIDO (Zoom Alejado: evita efecto código de barras) ---
          const topBoundary = series.createPriceLine({
            price: maxPrice,
            color: '#ef4444',
            lineWidth: 2 as LineWidth,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `TECHO ($${maxPrice.toFixed(0)})`,
          });
          priceLinesRef.current.push(topBoundary);

          const bottomBoundary = series.createPriceLine({
            price: minPrice,
            color: '#10b981',
            lineWidth: 2 as LineWidth,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `PISO ($${minPrice.toFixed(0)})`,
          });
          priceLinesRef.current.push(bottomBoundary);

          if (sellLevels.length > 0) {
            const avgSell = sellLevels.reduce((acc, l) => acc + l.price, 0) / sellLevels.length;
            const sellZoneLine = series.createPriceLine({
              price: avgSell,
              color: 'rgba(239, 68, 68, 0.75)',
              lineWidth: 1 as LineWidth,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `VENTA (${sellLevels.length})`,
            });
            priceLinesRef.current.push(sellZoneLine);
          }

          if (buyLevels.length > 0) {
            const avgBuy = buyLevels.reduce((acc, l) => acc + l.price, 0) / buyLevels.length;
            const buyZoneLine = series.createPriceLine({
              price: avgBuy,
              color: 'rgba(16, 185, 129, 0.75)',
              lineWidth: 1 as LineWidth,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: `COMPRA (${buyLevels.length})`,
            });
            priceLinesRef.current.push(buyZoneLine);
          }
        } else {
          // --- MODO DETALLADO (Sin texto sobre las velas para liberar el extremo derecho) ---
          gridLevels.forEach((level) => {
            const isActiveOrder = Boolean(level.activeOrder);
            const isHolding = level.isHolding;

            let color = '#475569';
            let lineWidth: LineWidth = 1 as LineWidth;
            let lineStyle = LineStyle.Dotted;
            let axisLabelVisible = false;

            if (isActiveOrder || isHolding) {
              if (isHolding || level.activeOrder?.side === 'SELL') {
                color = '#ef4444';
              } else {
                color = '#10b981';
              }
              lineWidth = 2 as LineWidth;
              lineStyle = LineStyle.Solid;
              axisLabelVisible = true; // Badge con el precio exacto en la barra de escala a la derecha
            }

            const priceLine = series.createPriceLine({
              price: level.price,
              color,
              lineWidth,
              lineStyle,
              axisLabelVisible,
              title: '', // Liberar extremos más importantes a la derecha
            });

            if (priceLine) {
              priceLinesRef.current.push(priceLine);
            }
          });
        }
      } catch (err) {
        console.warn('Advertencia actualizando líneas:', err);
      }
    });
  }, [gridLevels, lodMode, currentZoomLevel]);

  // Cargar velas de Binance API (hasta 1,000 velas) segun la temporalidad seleccionada
  const fetchKlinesData = useCallback((interval: CandleInterval) => {
    const series = candlestickSeriesRef.current;
    if (!series) return;

    fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=1000`)
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
          series.setData(formatted);
          if (formatted.length > 0) {
            const latestClose = formatted[formatted.length - 1].close;
            updateCurrentPriceLine(latestClose);
            onPriceUpdateRef.current(latestClose);
          }
        }
      })
      .catch((err) => console.warn('Klines fetch warning:', err));
  }, [updateCurrentPriceLine]);

  // Inicializar Gráfico TradingView UNA SOLA VEZ al montar el componente
  useEffect(() => {
    if (!chartContainerRef.current) return;

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

    // Detectar Zoom sin bucles
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const barsCount = range.to - range.from;
      const newZoomLevel = barsCount > 45 ? 'ZOOMED_OUT' : 'ZOOMED_IN';

      if (newZoomLevel !== zoomLevelRef.current) {
        zoomLevelRef.current = newZoomLevel;
        setTimeout(() => {
          setCurrentZoomLevel(newZoomLevel);
        }, 0);
      }
    });

    // Cargar 1,000 velas iniciales
    fetchKlinesData('1m');

    // Conectar a Binance WebSocket dinámico
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
          updateCurrentPriceLine(candle.close);
          onPriceUpdateRef.current(candle.close);
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
  }, [fetchKlinesData, updateCurrentPriceLine]);

  // Al cambiar la temporalidad (1m, 5m, 15m, 1h), re-descargar datos
  const handleIntervalChange = (newInterval: CandleInterval) => {
    setCandleInterval(newInterval);
    fetchKlinesData(newInterval);
  };

  // Actualizar líneas cuando cambie la grilla o la configuración LOD
  useEffect(() => {
    renderGridLines();

    const activeCount = gridLevels.filter((g) => g.activeOrder || g.isHolding).length;
    setActiveOrdersCount(activeCount);
  }, [gridLevels, renderGridLines]);

  return (
    <div className="glass-panel p-4 rounded-xl space-y-3 border border-slate-800 bg-slate-900/60 shadow-xl">
      {/* Header con Control de Renderizado por Nivel de Detalle (LOD) y Selector de Temporalidad */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          <h3 className="text-sm font-bold tracking-wide text-white uppercase flex items-center gap-2">
            Gráfico en Vivo BTC/USDT (Hasta 1,000 Velas)
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Legend del Precio Actual Amarillo */}
          {lastSpotPrice && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 font-mono text-[11px]">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Precio Spot: ${lastSpotPrice.toFixed(2)}</span>
            </div>
          )}

          {/* Selector de Temporalidad de Velas (1m, 5m, 15m, 1h) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <Clock className="w-3.5 h-3.5 text-slate-400 ml-1" />
            {(['1m', '5m', '15m', '1h'] as CandleInterval[]).map((tf) => (
              <button
                key={tf}
                onClick={() => handleIntervalChange(tf)}
                className={`px-2 py-0.5 rounded text-xs font-mono font-semibold transition-all ${
                  candleInterval === tf
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Controles de Modo LOD (Auto / Canal / Detallado) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setLodMode('AUTO')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold transition-all ${
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
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold transition-all ${
                lodMode === 'CHANNEL'
                  ? 'bg-slate-800 text-purple-400 border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ZoomOut className="w-3 h-3" />
              Canal
            </button>
            <button
              onClick={() => setLodMode('DETAILED')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold transition-all ${
                lodMode === 'DETAILED'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ZoomIn className="w-3 h-3" />
              Escalones
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-[11px] bg-slate-950/60 px-3 py-1 rounded-lg border border-slate-800 font-mono text-slate-300">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Vivas: {activeOrdersCount}
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
