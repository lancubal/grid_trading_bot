# 🗺️ Hoja de Ruta: De la Simulación a Producción (Simulation to Production Roadmap)

Este documento registra detalladamente las **diferencias arquitectónicas, mejoras algorítmicas y descubrimientos** desarrollados en el entorno de simulación (`src/simulation/`), para ser trasladados al bot real de producción en AWS EC2 una vez concluidos los experimentos de optimización.

---

## 📊 Tabla Comparativa de Arquitectura

| Componente / Mecanismo | Comportamiento Actual en Producción (`main`) | Mejora Descubierta en Simulación (`feature`) | Impacto Cuantitativo |
| :--- | :--- | :--- | :--- |
| **1. Dimensionamiento de Órdenes** | Divide el 100% de `availableUsdt` entre los niveles de compra (`usableUsdt / buyLevels.length`). | **Dimensionamiento Equilibrado:** Cada orden toma $\text{TargetOrderValue} = \frac{\text{Capital}}{\text{GRID\_LEVELS} - 1}$. | Evita quemar el 100% del USDT en una caída chica (4%), manteniendo reserva de cash para comprar en pisos reales. |
| **2. Ponderación por Proximidad (*Proximity-Weighted Sizing*)** | Todas las órdenes de la grilla tienen el mismo tamaño plano en USD. | Pondera $1.25x$ a las órdenes más cercanas al precio y $0.85x$ a las lejanas. | Aumenta el profit neto generado en la zona de mayor movimiento (*churn zone*). |
| **3. Reinversión de Beneficios (Compounding)** | Capital de la grilla fijo (`GRID_INVESTMENT`), el profit queda en balance libre o transferido. | **Compounding Continuo:** Cada flip de venta reinvierte el profit neto aumentando el tamaño de las órdenes en tiempo real. | Aumenta el rendimiento anualizado exponencialmente (interés compuesto). |
| **4. Blindaje de Bóveda Legacy** | La orden queda en Binance Spot GTC. Si se recentra, no se malvende abajo. | Idéntico. Se confirmó que mantener las ventas altas en Bóveda Legacy sin vender a pérdida es vital para sobrevivir a los mercados bajistas. | Evita pérdidas permanentes del 70-90% en caídas prolongadas. |

---

## 🛠️ Plan de Traslado a Producción (Paso a Paso)

Cuando estemos satisfechos con los resultados del Algoritmo Genético, los cambios a aplicar en el bot real son los siguientes:

### 1. Actualizar `src/core/gridManager.ts` (Dimensionamiento y Ponderación)
Modificar `generateSeedOrders` para usar el dimensionamiento equilibrado y la ponderación por proximidad:
```typescript
// En src/core/gridManager.ts:
const baseOrderUsd = investmentDec.dividedBy(this.config.gridLevels - 1);

// Ponderar por proximidad
for (let idx = 0; idx < buyLevels.length; idx++) {
  const level = buyLevels[idx];
  const weightFactor = new Decimal(Math.max(0.80, 1.25 - (idx * 0.08)));
  const targetOrderUsd = baseOrderUsd.times(weightFactor);

  if (usableUsdt.greaterThanOrEqualTo(targetOrderUsd.times(0.5))) {
    const orderCost = Decimal.min(targetOrderUsd, usableUsdt);
    usableUsdt = usableUsdt.minus(orderCost);
    const amount = orderCost.dividedBy(level.price);
    // ... agregar seed order
  }
}
```

### 2. Actualizar `src/index.ts` (Compounding Automático)
Habilitar la opción de expandir `investment` dinámicamente según el patrimonio total de la cuenta:
```typescript
// En el bucle periódico de src/index.ts:
if (config.ENABLE_AUTO_COMPOUNDING) {
  const currentEquity = usdtBalance.plus(btcBalance.times(currentMarketPrice));
  if (currentEquity.greaterThan(gridManager.getConfig().investment)) {
    gridManager.updateInvestment(currentEquity);
    logger.info(`📈 [Compounding] Capital de grilla actualizado a: $${currentEquity.toFixed(2)} USD`);
  }
}
```

### 3. Cargar las Variables de Entorno Óptimas
Actualizar el archivo `.env` en AWS EC2 (y los secrets de GitHub Actions) con los valores óptimos descubiertos por el Algoritmo Genético:
* `GRID_LEVELS`
* `ATR_PERIOD`
* `ATR_MULTIPLIER`
* `MIN_GRID_RANGE_USD`
* `MAX_GRID_RANGE_USD`
* `PRICE_DRIFT_UPPER_THRESHOLD` / `PRICE_DRIFT_LOWER_THRESHOLD`
* `PRICE_DRIFT_COOLDOWN_MINS`
* `CIRCUIT_BREAKER_DROP_PCT` / `CIRCUIT_BREAKER_WINDOW_MINS`
* `FOMO_COOLDOWN_HOURS`
