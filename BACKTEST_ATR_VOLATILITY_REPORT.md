# 📈 Reporte de Experimento: Grilla Adaptativa por Volatilidad (ATR)

- **Rama Git:** `feature/volatility-grid-atr`
- **Par de Trading:** `BTC/USDT`
- **Rango Base de Grilla:** `$63000.00 USD` - `$66000.00 USD`
- **Niveles de Grilla:** `15`
- **Inversión Inicial:** `$1000.00 USD`
- **Regla de Volatilidad (ATR 14):** En fases de baja volatilidad comprime el ancho a $1,500 USD con escalones estrechos. En fases de alta volatilidad expande el rango dinámicamente hasta $6,000 USD para mantenerse activo.

---

## 📊 Comparativa Directa: Grilla Estática vs Grilla Adaptativa ATR

### 🟢 30 Días:
| Métrica | Grilla Estática | Grilla Adaptativa ATR | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 203 | **2103** | **+1900 flips** |
| **Re-ajustes por ATR** | N/A | **101 eventos** | - |
| **Comisiones Maker (0.05%)** | $14.21 | $149.94 | - |
| **BENEFICIO NETO (USD)** | $34.17 | **+$113.00** | **+$78.83 USD** |
| **ROI NETO (%)** | +3.417% | **+11.300%** | **+7.883%** |
| **Horas Inactivo (Out of Bounds)** | 379.7 hrs | **0 hrs** | **-379.7 hrs** |

---

### 🟢 90 Días:
| Métrica | Grilla Estática | Grilla Adaptativa ATR | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 454 | **7490** | **+7036 flips** |
| **Re-ajustes por ATR** | N/A | **334 eventos** | - |
| **BENEFICIO NETO (USD)** | $75.74 | **+$311.27** | **+$235.53 USD** |
| **ROI NETO (%)** | +7.574% | **+31.127%** | **+23.553%** |
| **Horas Inactivo (Out of Bounds)** | 1568.35 hrs | **0.23 hrs** | **-1568.1 hrs** |

---

## 🔍 Hallazgos Cuantitativos y Conclusiones

1. **Reducción Dramática del Tiempo Inactivo:**
   - La Grilla Adaptativa ATR redujo la inactividad fuera de rango al expandir dinámicamente los límites cuando la volatilidad de mercado se disparó.

2. **Captura Fina de Micro-Movimientos:**
   - Durante períodos de compresión de volatilidad, la grilla se estrechó de forma autónoma a $1,500 USD, permitiendo capturar más micro-flips en oscilaciones laterales pequeñas.
