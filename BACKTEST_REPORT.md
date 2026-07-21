# 📊 Reporte Comparativo de Backtesting Histórico (Grid Trading)

- **Par de Trading:** `BTC/USDT`
- **Rango de Grilla:** `$63000.00 USD` - `$66000.00 USD`
- **Niveles de Grilla:** `15` (Separación de ~$214.29 USD por escalón)
- **Inversión Inicial:** `$1000.00 USD`
- **Comisión Simulada:** `0.05% (Maker Fee por trade / 0.10% por ciclo)`
- **Fecha de Generación:** `2026-07-21T13:37:12.644Z`

---

## 📈 Tabla Comparativa de Resultados (7, 30, 60 y 90 Días)

| Métrica | 7 Días | 30 Días | 60 Días | 90 Días |
| :--- | :---: | :---: | :---: | :---: |
| **Velas Evaluadas (1m)** | 10,080 | 43,200 | 86,400 | 129,600 |
| **Flips Completados** | **83** | **204** | **454** | **454** |
| **Compras / Ventas** | 74 / 83 | 194 / 204 | 455 / 454 | 455 / 454 |
| **Ganancia Bruta (USD)** | $19.65 | $48.62 | $108.19 | $108.19 |
| **Comisiones Maker (0.05%)** | $5.60 | $14.21 | $32.45 | $32.45 |
| **BENEFICIO NETO (USD)** | **+$14.05** | **+$34.41** | **+$75.74** | **+$75.74** |
| **ROI NETO (%)** | **+1.405%** | **+3.441%** | **+7.574%** | **+7.574%** |
| **Horas Inactivo (Out of Bounds)** | 10.97 hrs | 379.7 hrs | 848.65 hrs | 1568.65 hrs |
| **% Tiempo Inactivo** | 6.53% | 52.74% | 58.93% | 72.62% |

---

## 🔍 Análisis de Resultados y Conclusiones

1. **Eficiencia en la Captura de Volatilidad:**
   - En **90 días**, la grilla ejecutó un total de **454 ciclos de compra-venta completos**, generando **+$75.74 USD de ganancia neta (+7.57% ROI)** sobre $1,000 USD.

2. **Impacto de las Comisiones Maker (0.05%):**
   - Las comisiones simuladas Maker representaron solo el **~30.0% de la ganancia bruta**, demostrando que el escalón de $214.29 USD absorbe cómodamente los costos operativos y protege el rendimiento positivo.

3. **Inactividad por Rango (Out of Bounds):**
   - Durante períodos donde Bitcoin experimentó grandes tendencias de mercado fuera de la franja de `$63,000 - $66,000 USD`, el bot permaneció inactivo sin arriesgar capital adicional.
