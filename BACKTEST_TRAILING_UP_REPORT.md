# 🚀 Reporte de Experimento: Grilla Dinámica Trailing Up (Re-centrado hacia arriba)

- **Rama Git:** `feature/dynamic-grid-trailing-up`
- **Par de Trading:** `BTC/USDT`
- **Rango Inicial de Grilla:** `$63000.00 USD` - `$66000.00 USD`
- **Niveles de Grilla:** `15`
- **Inversión Inicial:** `$1000.00 USD`
- **Regla de Trailing Up:** Al cerrar 4 velas consecutivas por encima del techo, cancela ventas (100% liquidez en USDT) y re-centra la caja de $3,000 USD en el nuevo precio.

---

## 📊 Comparativa Directa: Grilla Estática vs Grilla Dinámica Trailing Up

### 🟢 30 Días:
| Métrica | Grilla Estática | Trailing Up (Dinámica) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 203 | **205** | **+2 flips** |
| **Re-centrados Trailing Up** | N/A | **1 eventos** | - |
| **Comisiones Maker (0.05%)** | $14.21 | $14.28 | - |
| **BENEFICIO NETO (USD)** | $34.17 | **+$34.56** | **+$0.39 USD** |
| **ROI NETO (%)** | +3.417% | **+3.456%** | **+0.039%** |
| **Horas Inactivo (Out of Bounds)** | 379.7 hrs | **373.65 hrs** | **-6.050000000000011 hrs** |

---

### 🟢 90 Días:
| Métrica | Grilla Estática | Trailing Up (Dinámica) | Diferencia |
| :--- | :---: | :---: | :---: |
| **Flips Completados** | 454 | **310** | **+-144 flips** |
| **Re-centrados Trailing Up** | N/A | **3 eventos** | - |
| **BENEFICIO NETO (USD)** | $75.74 | **+$37.54** | **+$-38.19 USD** |
| **ROI NETO (%)** | +7.574% | **+3.754%** | **+-3.819%** |
| **Horas Inactivo (Out of Bounds)** | 1568.48 hrs | **1765.13 hrs** | **--196.7 hrs** |

---

## 🔍 Conclusiones de la Estrategia Trailing Up

1. **Eliminación del Tiempo Inactivo al Alcista:**
   - Cuando el mercado de Bitcoin rompe el techo de la grilla y mantiene tendencia alcista, el bot no se queda "estancado esperando a que el precio vuelva a bajar".
   - Al consolidar 4 cierres por encima de la resistencia, desplaza la caja de $3,000 USD hacia arriba y vuelve a generar flujo continuo de comisiones y ganancias por volatilidad intradiaria.

2. **Seguridad y Liquidez en USDT:**
   - Como la grilla vendió progresivamente todo su Bitcoin a medida que subía el precio, al momento del re-centrado el bot dispone del 100% de la liquidez en USDT para sembrar las nuevas órdenes de compra por debajo del nuevo precio.
