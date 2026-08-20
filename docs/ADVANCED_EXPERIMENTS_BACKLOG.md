# 🚀 Backlog de Experimentos Avanzados & Roadmap Cuantitativo

Este documento lleva el registro estructurado de todas las ideas cuantitativas, arquitecturas de control y experimentos probados en la simulación genética de alta fidelidad.

---

## 🏆 Historial de Benchmarks Evolutivos (Test Ciego 2023–2024)

| Fase / Arquitectura | ROI Total Test | APY Anualizado | Ganancia Neta ($10k) | Trades en Test | Reporte Guardado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Grilla Simétrica 18 Niveles** | +53.29% | 44.40% | +$5,329.46 USD | 3,335 trades | [`report_multicore_18levels.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_18levels.json) |
| **2. Grilla Simétrica 11 Niveles (100x30)** | +69.57% | 57.97% | +$6,957.47 USD | 1,377 trades | [`report_multicore_100x30.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_100x30.json) |
| **3. Grilla Asimétrica Alcista** | +90.69% | 75.56% | +$9,068.53 USD | 863 trades | Registrado en bitácora |
| 👑 **4. Doble Capa Micro/Macro Grid** | **`+93.98%`** | **`78.30% anual`** | **`+$9,397.79 USD`** | **`2,082 trades`** | [`report_multicore_dual_layer.json`](file:///home/luna/repos/dayTradingBot/docs/optimization_benchmarks/report_multicore_dual_layer.json) |

---

## 🎛️ 1. Control Integral PID & Orquestador de Régimen de Mercado (Macro Controller)
* **Concepto:** Mapeo de la teoría de control clásica (PID) para añadir un nivel de control superior a largo plazo.
  * **P (Proporcional):** ATR dinámico instantáneo adaptando el ancho de la grilla.
  * **D (Derivativo):** Cortacircuitos (velocity dump) y FomoGuard (peak breakout).
  * **I (Integral):** Clasificador de régimen macro (Bull, Crab, Bear, Squeeze) en ventana de 30-90 días que reconfigura los parámetros en caliente.
* **Referencia Técnica:** [`docs/CONTROL_THEORY_INTEGRAL_ORCHESTRATOR.md`](file:///home/luna/repos/dayTradingBot/docs/CONTROL_THEORY_INTEGRAL_ORCHESTRATOR.md).
* **Estado:** Planificado para Fase de Arquitectura en Producción.

---

## ⚡ 2. Arquitectura de Doble Capa (Micro-Grid + Macro-Grid Layering)
* **Resultado:** Validada con **`+93.98% ROI / 78.30% APY`** y más de **2,080 trades**.
* **Configuración Ganadora (Campeón #3):**
  * **Macro Grid:** 9 niveles, rango $7,000 - $8,800 USD, Take-Profit asimétrico 1.8x.
  * **Micro Grid:** 6 niveles, rango $2,240 USD (pasos de ~$250 USD) con 25% del capital.
* **Estado:** Implementada y lista para migrar a producción.

---

## 🛡️ 3. Validación Walk-Forward en 4 Ventanas Rodantes
* **Concepto:** Matrix de validación cruzada temporal sin fuga de datos:
  * Ventana 1: Train 2020 ➔ Test 2021 (Bull market temprano).
  * Ventana 2: Train 2021 ➔ Test 2022 (Bear market & colapso -77%).
  * Ventana 3: Train 2022 ➔ Test 2023 (Consolidación y recuperación).
  * Ventana 4: Train 2023 ➔ Test 2024 (Rally institucional y All-Time Highs).
* **Beneficio Esperado:** Certificación matemática de robustez contra sobreajuste (*overfitting*).
* **Estado:** En backlog de validación final.
