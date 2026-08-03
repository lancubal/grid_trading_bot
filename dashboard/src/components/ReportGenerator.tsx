'use client';

import React, { useState } from 'react';
import {
  FileText,
  Download,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  Zap,
  Activity,
  Calendar,
  Grid,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import {
  generatePerformanceReport,
  exportFlipsCsv,
  TearSheetReportData,
  DailyHeatmapDay,
} from '@/lib/actions';

type PeriodKey = '24h' | '7d' | '30d' | '90d';

export function ReportGenerator() {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [reportData, setReportData] = useState<TearSheetReportData | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorReason(null);
    try {
      const res = await generatePerformanceReport(period);
      if (res.success && res.data) {
        setReportData(res.data);
      } else {
        setReportData(null);
        setErrorReason(res.reason || 'No se pudo generar el reporte.');
      }
    } catch (err) {
      console.error(err);
      setErrorReason('Error conectando con PostgreSQL para generar el reporte.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!reportData) return;
    navigator.clipboard.writeText(reportData.markdownReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const csvContent = await exportFlipsCsv(period);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `grid_trading_flips_${period}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error descargando CSV:', err);
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  // Asignar colores al Heatmap estilo GitHub según intensidad (0 a 4)
  const getIntensityColor = (intensity: 0 | 1 | 2 | 3 | 4) => {
    switch (intensity) {
      case 0:
        return 'bg-slate-800/80 border-slate-700/50 text-slate-500 hover:border-slate-600';
      case 1:
        return 'bg-emerald-950/80 border-emerald-800/60 text-emerald-400 hover:border-emerald-500';
      case 2:
        return 'bg-emerald-800/90 border-emerald-600/80 text-emerald-200 hover:border-emerald-400';
      case 3:
        return 'bg-emerald-600 text-slate-950 font-bold hover:bg-emerald-500';
      case 4:
        return 'bg-emerald-400 text-slate-950 font-extrabold shadow-lg shadow-emerald-500/40 hover:bg-emerald-300';
    }
  };

  return (
    <div className="glass-panel p-5 rounded-xl space-y-4 border border-slate-800 bg-slate-900/60 shadow-xl print:bg-white print:text-black">
      {/* Header del Generador */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3 print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wide">
              Generador de Reporte Institucional (Tear Sheet)
            </h3>
            <p className="text-xs text-slate-400">
              Métricas de salud del grid, mapa de calor de actividad diaria y exportación limpia a PDF/CSV
            </p>
          </div>
        </div>

        {/* Acciones de Selección de Período y Botón Generar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {(['24h', '7d', '30d', '90d'] as PeriodKey[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  period === p
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Generar Tear Sheet
          </button>
        </div>
      </div>

      {/* Mensaje de Error si la antigüedad no alcanza */}
      {errorReason && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center gap-2.5 text-xs text-rose-300 print:hidden">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorReason}</span>
        </div>
      )}

      {/* Vista previa del Tear Sheet Generado */}
      {reportData ? (
        <div className="space-y-5 animate-fadeIn">
          {/* 1. Bar de Acciones de Exportación Limpia */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/80 p-3 rounded-lg border border-slate-800/80 print:hidden">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Tear Sheet Listo (`{reportData.periodKey.toUpperCase()}`) — Generado a las {reportData.generatedAt} UTC</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Botón Descargar CSV */}
              <button
                onClick={handleExportCsv}
                disabled={isExportingCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold rounded-lg transition-all shadow-sm"
              >
                {isExportingCsv ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />}
                Exportar CSV (Excel)
              </button>

              {/* Botón Exportar PDF / Imprimir */}
              <button
                onClick={handlePrintPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 text-xs font-semibold rounded-lg transition-all shadow-sm"
              >
                <Printer className="w-3.5 h-3.5 text-purple-400" />
                Imprimir / PDF
              </button>

              {/* Botón Copiar Markdown */}
              <button
                onClick={handleCopyMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg transition-all shadow-sm"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                {copied ? 'Copiado' : 'Copiar MD'}
              </button>
            </div>
          </div>

          {/* 2. Métricas de Salud del Grid (Grid Health Cards) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card A: Tiempo de Vida del Flip */}
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Tiempo Promedio de Vida del Flip</span>
                <Clock className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-xl font-mono font-bold text-cyan-300">
                {reportData.avgFlipLifecycleMins} mins
              </div>
              <p className="text-[10px] text-slate-400">
                Duración media desde la ejecución de compra límite hasta la venta en contra-orden
              </p>
            </div>

            {/* Card B: Eficiencia de Capital */}
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Eficiencia de Capital Activo</span>
                <Zap className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl font-mono font-bold text-emerald-400">
                {reportData.capitalEfficiencyPercent}%
              </div>
              <p className="text-[10px] text-slate-400">
                Porcentaje del capital asignado trabajando activamente en órdenes de grilla e inventario
              </p>
            </div>

            {/* Card C: Frecuencia y Velocidad de Flips */}
            <div className="bg-slate-950/70 p-3.5 rounded-lg border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Velocidad de Operativa</span>
                <Activity className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-mono font-bold text-purple-300">
                {reportData.flipsPerDay} Flips / día
              </div>
              <p className="text-[10px] text-slate-400">
                Frecuencia diaria de ciclos de ganancia completados en el período
              </p>
            </div>
          </div>

          {/* 3. Mapa de Calor de Actividad Diaria (Estilo GitHub Heatmap) */}
          <div className="bg-slate-950/70 p-4 rounded-lg border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Mapa de Calor de Actividad Diaria (Volatilidad & Flips)
                </h4>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span>Menos actividad</span>
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-slate-800" />
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-950 border border-emerald-800" />
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-800" />
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" />
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                </div>
                <span>Más actividad</span>
              </div>
            </div>

            {/* Matriz de Cuadraditos */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {reportData.heatmapDays.map((day) => (
                <div
                  key={day.dateStr}
                  title={`${day.dateStr}: ${day.flipsCount} flips completados (+$${day.profitUsd} USD)`}
                  className={`group relative w-8 h-8 rounded-md flex flex-col items-center justify-center border transition-all duration-200 cursor-pointer ${getIntensityColor(
                    day.intensity
                  )}`}
                >
                  <span className="text-[10px] font-mono leading-none">{day.dayNumber}</span>
                  {day.flipsCount > 0 && (
                    <span className="text-[8px] font-mono font-bold leading-none mt-0.5">
                      {day.flipsCount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-8 text-center bg-slate-950/40 rounded-lg border border-dashed border-slate-800 space-y-3 print:hidden">
          <Grid className="w-8 h-8 text-slate-600 mx-auto" />
          <div className="text-xs text-slate-400">
            Seleccioná una temporalidad y hacé clic en <strong className="text-cyan-300 font-semibold">Generar Tear Sheet</strong> para construir el reporte cuantitativo.
          </div>
        </div>
      )}
    </div>
  );
}
