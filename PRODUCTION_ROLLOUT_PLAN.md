# 🛡️ Plan de Despliegue Gradual en Producción (Capital Allocation)

Este documento establece la hoja de ruta estratégica para la transición de **Shadow Trading** a **Producción Real** en Binance Spot, garantizando la preservación del capital y la validación empírica de latencia y comisiones Maker.

---

## 🎯 Filosofía de Gestión de Riesgo

El mayor peligro al pasar a producción real es dimensionar la grilla con el 100% del capital sin haber verificado previamente:
1. Latencia de ejecución en vivo en la instancia AWS EC2.
2. Micro-deslizamientos (slippage) durante volatilidad repentina.
3. Conciliación exacta de comisiones Maker (0.05%) al centavo.

---

## 🗺️ Fases de Despliegue de Capital

### 🔹 Fase 1: Pruebas en Vivo con Capital Reducido (Semanas 1 y 2)
- **Capital Asignado:** 15% - 20% del capital total (~$1,500 a $2,000 USD).
- **Parámetros `.env` Recomendados:**
  ```env
  DRY_RUN="false"
  EXCHANGE_TESTNET="false"
  GRID_INVESTMENT="1000.00"
  MAX_ORDER_VALUE_USD="100.00"
  ```
- **Asignación Física:**
  - $1,000 USDT para órdenes límite de compra inferiores.
  - Equivale a ~0.015 BTC para órdenes límite de venta superiores.
- **Criterios de Éxito para Aprobación:**
  - 14 días consecutivos de uptime sin fallos no controlados.
  - Reconexión transparente de WebSockets (`watchOrders`).
  - Coincidencia exacta al centavo entre el balance en el Dashboard local y la API de Binance Spot.

---

### 🔹 Fase 2: Escalado Gradual por Interés Compuesto (Mes 2 en adelante)
- **Incremento Programado:** +$2,000 USD adicionales por mes en `GRID_INVESTMENT`.
- **Re-balanceo por ATR:** Mantener el rango dinámico de $1,500 a $6,000 USD según la volatilidad semanal.
- **Protección Automática:** Mantener `RiskGuard` activo con `MAX_ORDER_VALUE_USD` ajustado proporcionalmente.

---

## 📊 Matriz de Control de Riesgo

| Parámetro | Fase 1 (Inicial) | Fase 2 (Escalado 1) | Fase 3 (Plena Capacidad) |
| :--- | :---: | :---: | :---: |
| **Capital Total** | $1,500 - $2,000 USD | $4,000 USD | $10,000+ USD |
| **`GRID_INVESTMENT`** | $1,000.00 | $2,000.00 | $5,000.00+ |
| **`MAX_ORDER_VALUE_USD`** | $100.00 | $200.00 | $500.00 |
| **Modo Execution** | Real (`DRY_RUN=false`) | Real (`DRY_RUN=false`) | Real (`DRY_RUN=false`) |
| **Frecuencia Auditoría** | Diaria (Dashboard SSH) | Semanal | Mensual |
