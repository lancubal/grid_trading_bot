'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Download, Copy, Check, Lock, AlertCircle, Clock, Calendar } from 'lucide-react';
import { getSystemAgeInfo, generatePerformanceReport, SystemAgeInfo } from '../lib/actions';

export function ReportGenerator() {
  const [ageInfo, setAgeInfo] = useState<SystemAgeInfo | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    fetchAgeInfo();
  }, []);

  const fetchAgeInfo = async () => {
    const info = await getSystemAgeInfo();
    setAgeInfo(info);
  };

  const handleGenerate = async (period: '24h' | '7d' | '30d' | '90d') => {
    setSelectedPeriod(period);
    setIsLoading(true);
    setErrorMsg(null);
    setGeneratedReport(null);

    const result = await generatePerformanceReport(period);

    if (result.success && result.markdownReport) {
      setGeneratedReport(result.markdownReport);
    } else {
      setErrorMsg(result.reason || 'No se pudo generar el reporte.');
    }
    setIsLoading(false);
  };

  const handleCopy = () => {
    if (generatedReport) {
      navigator.clipboard.writeText(generatedReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (generatedReport) {
      const blob = new Blob([generatedReport], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reporte_bot_grid_${selectedPeriod}_${new Date().toISOString().slice(0, 10)}.md`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const periods: { key: '24h' | '7d' | '30d' | '90d'; label: string; daysNeeded: number }[] = [
    { key: '24h', label: 'Últimas 24h', daysNeeded: 1 },
    { key: '7d', label: 'Últimos 7 Días', daysNeeded: 7 },
    { key: '30d', label: 'Últimos 30 Días', daysNeeded: 30 },
    { key: '90d', label: 'Últimos 90 Días', daysNeeded: 90 },
  ];

  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-6 shadow-xl mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">Generador de Reportes de Performance</h2>
            <p className="text-xs text-slate-400">Exporta informes auditables con el formato estándar de backtesting</p>
          </div>
        </div>

        {ageInfo && (
          <div className="flex items-center gap-2 text-xs bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-300">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>Antigüedad del sistema: <strong className="text-blue-400">{ageInfo.ageInDays} días</strong> ({ageInfo.ageInHours}h)</span>
          </div>
        )}
      </div>

      {/* Selector de Períodos con Validación de Antigüedad */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {periods.map((p) => {
          const isAvailable = ageInfo ? ageInfo.availablePeriods[p.key] : false;

          return (
            <button
              key={p.key}
              onClick={() => isAvailable && handleGenerate(p.key)}
              disabled={!isAvailable || isLoading}
              className={`relative flex flex-col items-center justify-center p-3 rounded-lg border transition-all text-xs font-semibold ${
                !isAvailable
                  ? 'bg-slate-950/40 border-slate-800 text-slate-600 cursor-not-allowed'
                  : selectedPeriod === p.key && generatedReport
                  ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-md shadow-emerald-500/10'
                  : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {!isAvailable ? (
                  <Lock className="w-3.5 h-3.5 text-slate-600" />
                ) : (
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>{p.label}</span>
              </div>

              {!isAvailable && ageInfo && (
                <span className="text-[10px] text-amber-500/80 font-normal">
                  Req. {p.daysNeeded}d ({ageInfo.ageInDays}d act.)
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Alerta de Error por Antigüedad Insuficiente */}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-xs mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Visualizador del Reporte Generado */}
      {generatedReport && (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-slate-950 px-4 py-2 border border-slate-800 rounded-t-lg">
            <span className="text-xs font-mono text-slate-400">reporte_performance_{selectedPeriod}.md</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar (.md)</span>
              </button>
            </div>
          </div>

          <pre className="bg-slate-950 p-4 rounded-b-lg border border-t-0 border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto max-h-96 whitespace-pre-wrap leading-relaxed">
            {generatedReport}
          </pre>
        </div>
      )}
    </div>
  );
}
