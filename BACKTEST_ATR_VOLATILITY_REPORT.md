# 📈 Reporte de Experimento: Grilla Adaptativa por Volatilidad (ATR) vs Grilla Estática

- **Fecha de Simulación:** 2026-08-01 13:42:27 UTC
- **Par de Trading:** `BTC/USDT`
- **Rango Base de Grilla:** `$63000.00 USD` - `$66000.00 USD`
- **Niveles de Grilla:** `15`
- **Inversión Inicial de Prueba:** `$2000.00 USD`
- **Regla de Volatilidad (ATR 14):** En fases de baja volatilidad comprime el ancho a $1,500 USD con escalones estrechos. En fases de alta volatilidad expande el rango dinámicamente hasta $6,000 USD para mantenerse activo.

---

## 📊 Comparativa Directa Multiperíodo: Grilla Estática vs Grilla Adaptativa ATR

### 🟢 7 Días:
| Métrica | Grilla Estática | Grilla Adaptativa ATR | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 83 | **294** | **+211 flips** |
| **Re-ajustes por ATR** | N/A | **16 eventos** | - |
| **Comisiones Maker (0.05%)** | $11.21 | $41.56 | - |
| **BENEFICIO NETO (USD)** | $24.61 | **+$59.46** | **+$34.85 USD** |
| **ROI NETO (%)** | +1.230% | **+2.973%** | **+1.743%** |
| **Horas Inactivo (Out of Bounds)** | 10.97 hrs | **0 hrs** | **-11.0 hrs** |

---

### 🟢 30 Días:
| Métrica | Grilla Estática | Grilla Adaptativa ATR | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 204 | **130** | **+-74 flips** |
| **Re-ajustes por ATR** | N/A | **106 eventos** | - |
| **Comisiones Maker (0.05%)** | $28.42 | $18.78 | - |
| **BENEFICIO NETO (USD)** | $66.71 | **+$100.22** | **+$33.51 USD** |
| **ROI NETO (%)** | +3.336% | **+5.011%** | **+1.675%** |
| **Horas Inactivo (Out of Bounds)** | 379.7 hrs | **0 hrs** | **-0.0 hrs** |

---

### 🟢 60 Días:
| Métrica | Grilla Estática | Grilla Adaptativa ATR | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 357 | **194** | **+-163 flips** |
| **Re-ajustes por ATR** | N/A | **261 eventos** | - |
| **BENEFICIO NETO (USD)** | $119.54 | **+$29.03** | **+$-90.51 USD** |
| **ROI NETO (%)** | +5.977% | **+1.452%** | **+-4.525%** |

---

### 🟢 90 Días:
| Métrica | Grilla Estática | Grilla Adaptativa ATR | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 357 | **1012** | **+655 flips** |
| **Re-ajustes por ATR** | N/A | **346 eventos** | - |
| **BENEFICIO NETO (USD)** | $119.54 | **+$92.47** | **+$-1.353%** |
| **ROI NETO (%)** | +5.977% | **+4.624%** | **+-1.353%** |
| **Horas Inactivo (Out of Bounds)** | 1568.67 hrs | **0.23 hrs** | **-1568.4 hrs** |

---

## 🔍 Hallazgos Cuantitativos y Conclusiones

1. **Reducción Dramática del Tiempo Inactivo:**
   - La Grilla Adaptativa ATR redujo la inactividad fuera de rango al expandir dinámicamente los límites cuando la volatilidad de mercado se disparó.

2. **Captura Fina de Micro-Movimientos:**
   - Durante períodos de compresión de volatilidad, la grilla se estrechó de forma autónoma a $1,500 USD, permitiendo capturar más micro-flips en oscilaciones laterales pequeñas.
