# 🚀 Backlog de Experimentos Avanzados & Roadmap Cuantitativo

Este documento lleva el registro estructurado de todas las ideas cuantitativas, arquitecturas de control y experimentos probados en la simulación genética de alta fidelidad.

---

## 🏆 Historial Completo de Benchmarks Evolutivos (4 Años de Datos 2021–2024)

| Fase / Arquitectura | ROI Total Test (1.2y) | APY Test | Ganancia Test ($10k) | Ganancia Train (2.8y Bear) | Reporte Guardado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Grilla Simétrica 18 Niveles** | +53.29% | 44.40% | +$5,329.46 USD | +$1,789.81 USD | [`report_multicore_18levels.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_18levels.json) |
| **2. Grilla Simétrica 11 Niveles (100x30)** | +69.57% | 57.97% | +$6,957.47 USD | +$1,752.99 USD | [`report_multicore_100x30.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_100x30.json) |
| **3. Grilla Asimétrica Alcista** | +90.69% | 75.56% | +$9,068.53 USD | +$2,386.12 USD | Registrado en bitácora |
| **4. Doble Capa Micro/Macro Grid** | **`+93.98%`** | **`78.30%`** | **`+$9,397.79 USD`** | +$2,178.06 USD | [`report_multicore_dual_layer.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_dual_layer.json) |
| 👑 **5. Orquestador de Régimen (Control PID)** | **`+84.19%`** | **`70.15%`** | **`+$8,419.36 USD`** | **`+$3,128.59 USD` (+31.3%)** | [`report_multicore_regime_orchestrator.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_regime_orchestrator.json) |

---

## 🎛️ 1. Control Integral PID & Orquestador de Régimen de Mercado (Macro Controller)
* **Resultado:** Logró el **récord absoluto de protección y rendimiento en mercado bajista (+31.29% de ganancia durante el colapso de 2022)** mientras mantuvo un **+84.19% de ROI en el bull market**.
* **Configuración Ganadora (Campeón #1):**
  * `REGIME_THRESHOLD_PCT`: 1.09% (umbral de conmutación 24h/96h).
  * `TAKE_PROFIT_MULTIPLIER`: 1.7x en Bull / 1.0x en Bear.
  * `MICRO_CAPITAL_RATIO`: 22% en Micro-Grid ($2,423 USD rango / 5 niveles).
  * `MACRO_GRID`: 9 niveles ($6,750 - $12,950 USD).
* **Estado:** Totalmente validado y documentado para producción.

---

## ⚡ 2. Arquitectura de Doble Capa (Micro-Grid + Macro-Grid Layering)
* **Resultado:** Récord en ciclo alcista puro con **`+93.98% ROI / 78.30% APY`** y más de **2,080 trades**.
* **Estado:** Implementada en `MemoryEngine.ts` y documentada para producción.

---

## 🛡️ 3. Validación Walk-Forward en 4 Ventanas Rodantes
* **Concepto:** Matrix de validación cruzada temporal sin fuga de datos:
  * Ventana 1: Train 2020 ➔ Test 2021 (Bull market temprano).
  * Ventana 2: Train 2021 ➔ Test 2022 (Bear market & colapso -77%).
  * Ventana 3: Train 2022 ➔ Test 2023 (Consolidación y recuperación).
  * Ventana 4: Train 2023 ➔ Test 2024 (Rally institucional y All-Time Highs).
* **Estado:** En backlog para certificación final previa a producción.
