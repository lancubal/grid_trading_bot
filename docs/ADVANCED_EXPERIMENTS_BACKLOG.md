# 🚀 Backlog de Experimentos Avanzados & Roadmap Cuantitativo

Este documento lleva el registro estructurado de todas las ideas cuantitativas, arquitecturas de control y experimentos a probar en fases posteriores.

---

## 🎛️ 1. Control Integral PID & Orquestador de Régimen de Mercado
* **Concepto:** Mapeo de la teoría de control clásica (PID) para añadir un nivel de control superior a largo plazo.
  * **P (Proporcional):** ATR dinámico instantáneo adaptando el ancho de la grilla.
  * **D (Derivativo):** Cortacircuitos (velocity dump) y FomoGuard (peak breakout).
  * **I (Integral):** Clasificador de régimen macro (Bull, Crab, Bear, Squeeze) en ventana de 30-90 días que reconfigura los parámetros en caliente.
* **Referencia Técnica:** [`docs/CONTROL_THEORY_INTEGRAL_ORCHESTRATOR.md`](file:///home/luna/repos/dayTradingBot/docs/CONTROL_THEORY_INTEGRAL_ORCHESTRATOR.md).
* **Estado:** Planificado para Fase de Arquitectura en Producción.

---

## ⚡ 2. Arquitectura de Doble Capa (Micro-Grid + Macro-Grid Layering)
* **Concepto:** Dividir el capital en dos grillas superpuestas y concurrentes:
  * **Capa Rápida (40% capital):** 6 niveles ultra-densos con $\Delta = \$150 - \$220\text{ USD}$ para cosechar entre 15 y 30 micro-flips diarios en mercados laterales.
  * **Capa Lenta (60% capital):** 5 niveles amplios con $\Delta = \$1,000 - \$1,500\text{ USD}$ como red de amortiguación pesada ante grandes oscilaciones de mercado.
* **Beneficio Esperado:** Máxima frecuencia diaria de flujo de caja + robustez ante grandes tendencias.
* **Estado:** En backlog para testing comparativo.

---

## 🛡️ 3. Validación Walk-Forward en 4 Ventanas Rodantes
* **Concepto:** Matrix de validación cruzada temporal sin fuga de datos:
  * Ventana 1: Train 2020 ➔ Test 2021 (Bull market temprano).
  * Ventana 2: Train 2021 ➔ Test 2022 (Bear market & colapso -77%).
  * Ventana 3: Train 2022 ➔ Test 2023 (Consolidación y recuperación).
  * Ventana 4: Train 2023 ➔ Test 2024 (Rally institucional y All-Time Highs).
* **Beneficio Esperado:** Certificación matemática de robustez contra sobreajuste (*overfitting*).
* **Estado:** En backlog de validación final.

---

## 📊 4. Registro de Benchmarks Históricos
* **Benchmark 1 (Grid Simétrica 18 Niveles Multi-Core):** [`docs/optimization_benchmarks/report_multicore_18levels.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_18levels.json) — +53.29% ROI Test / 44.4% APY.
* **Benchmark 2 (Grid Simétrica 11 Niveles 100x30):** +69.57% ROI Test / 57.97% APY ($6,957 USD netos).
* **Benchmark 3 (Grilla Asimétrica Alcista - En curso):** Evaluando multiplicador de profit `1.0x - 2.0x` y asignación de capital `50% - 70%`.
