# ⚠️ Reporte de Experimento: Grilla Dinámica Trailing Down (Stop-Loss 3%)

- **Rama Git:** `feature/dynamic-grid-trailing-down`
- **Par de Trading:** `BTC/USDT`
- **Rango Inicial de Grilla:** `$63000.00 USD` - `$66000.00 USD`
- **Niveles de Grilla:** `15`
- **Inversión Inicial:** `$1000.00 USD`
- **Regla de Stop-Loss:** Si el precio rompe el piso de los $63,000 USD en más del 3% (por debajo de $61,110 USD) durante 4 cierres consecutivos, liquida el inventario acumulado de BTC a pérdida y re-centra la caja en el nuevo precio.

---

## 📊 Comparativa Directa: Grilla Estática vs Trailing Down (Stop-Loss 3%)

### 🟢 30 Días:
| Métrica | Grilla Estática | Trailing Down (Stop-Loss 3%) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 203 | **213** | **+10 flips** |
| **Re-centrados Trailing Down** | N/A | **1 eventos** | - |
| **Pérdida por Stop-Loss (USD)** | $0.00 | **$57.87 USD** | - |
| **Comisiones Maker (0.05%)** | $14.21 | $15.17 | - |
| **BENEFICIO NETO (USD)** | $34.17 | **$-19.84** | **$-54.01 USD** |
| **ROI NETO (%)** | +3.417% | **-1.984%** | **-5.401%** |
| **Horas Inactivo (Out of Bounds)** | 379.7 hrs | **459.33 hrs** | **--79.6 hrs** |

---

### 🟢 90 Días:
| Métrica | Grilla Estática | Trailing Down (Stop-Loss 3%) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 454 | **469** | **+15 flips** |
| **Re-centrados Trailing Down** | N/A | **1 eventos** | - |
| **Pérdida por Stop-Loss (USD)** | $0.00 | **$61.23 USD** | - |
| **BENEFICIO NETO (USD)** | $75.74 | **$21.72** | **$-54.02 USD** |
| **ROI NETO (%)** | +7.574% | **2.172%** | **-5.402%** |
| **Horas Inactivo (Out of Bounds)** | 1568.4 hrs | **1813.27 hrs** | **--244.9 hrs** |

---

## 🔍 Hallazgos Cuantitativos y Conclusiones del Experimento

1. **Alto Riesgo de la Liquidación a Pérdida:**
   - Durante caídas de mercado, la grilla estática compra Bitcoin progresivamente y los mantiene de forma segura en inventario sin realizar pérdidas.
   - En cambio, **Trailing Down liquida a mercado (Stop-Loss)** los Bitcoin comprados durante la bajada cuando el precio cae por debajo del 3% del piso ($61,110 USD), cristalizando una pérdida efectiva que destruye parte del rendimiento generado por los flips anteriores.

2. **Recomendación Cuantitativa:**
   - En estrategias de Grid Trading sobre activos de alta calidad como Bitcoin (BTC), la grilla estática o con un freno pasivo es significativamente más segura y rentable que el Stop-Loss / Trailing Down activo, el cual es vulnerable a falsas rupturas (*whipsaws*) y liquidaciones prematuras.
