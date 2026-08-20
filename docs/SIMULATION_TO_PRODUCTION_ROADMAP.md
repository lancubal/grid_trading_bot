# 🗺️ Hoja de Ruta Técnica: De la Simulación a Producción (Spot Bot)

Este documento detalla exhaustivamente **cada descubrimiento y optimización validada en el simulador** y el **código TypeScript exacto** que deberá implementarse en el bot de producción (`src/core/gridManager.ts` e `src/index.ts`) para transferir el 100% de las mejoras a Binance Spot en AWS.

---

## 📋 Resumen de Diferencias Clave (Simulación vs. Producción Anterior)

| Mecanismo | Comportamiento Anterior en Producción | Nueva Lógica Optimizada en Simulación | Archivo Objetivo en Producción |
| :--- | :--- | :--- | :--- |
| **Contabilidad de Balances** | Balance simple (riesgo de vender en pérdida al recentrar) | **5 Saldos Físicos:** `usdtFree`, `usdtLocked`, `btcFree`, `btcLockedActive`, `btcLockedLegacy` | `src/core/gridManager.ts` |
| **Venta a Pérdida** | Cancelaba y re-sembraba BTC al precio actual más bajo | **Bóveda Legacy:** El BTC comprado arriba queda esperando su precio alto original | `src/core/gridManager.ts` |
| **Dimensionamiento de Órdenes** | `usdtFree / buyLevels.length` (agotaba liquidez en 5 niveles) | **Ponderación Exponencial:** $1.35x$ en el centro y reserva de efectivo para caídas | `src/core/gridManager.ts` |
| **Compounding** | Tamaño fijo por orden durante toda la vida del bot | **Compounding Continuo Realizado:** La ganancia neta realizada expande el capital activo | `src/index.ts` & `gridManager.ts` |
| **Grilla Asimétrica Alcista** | Paso de venta = 1.0x $\Delta$ (vende de inmediato en subidas) | **Take-Profit Asimétrico:** Multiplicador $1.8x - 2.0x$ en ventas para dejar correr el rally | `src/core/gridManager.ts` |
| **Arquitectura de Doble Capa** | Una sola grilla rígida | **Micro-Grid ($250 USD step) + Macro-Grid ($1,000 USD step)** concurrentes | `src/core/gridManager.ts` |
| **Reinyección de Liquidez** | Liquidez liberada quedaba ociosa | **Reinyección Inmediata:** Fondos liberados de ventas altas compran en la grilla activa | `src/core/gridManager.ts` |

---

## 🛠️ Código TypeScript a Migrar en Producción

### 1. En `src/core/gridManager.ts`:
#### A. Soporte para Bóveda Legacy (Cero Venta a Pérdida)
```typescript
interface LegacyOrder {
  orderId: string;
  price: number;
  amount: number;
}

export class GridManager {
  private legacyVault: LegacyOrder[] = [];

  // Al recentrar out-of-bounds o por drift:
  public async recenterGrid(currentPrice: number, currentAtr: number): Promise<void> {
    // 1. Cancelar compras abiertas liberando USDT al saldo libre
    // 2. Para las ventas abiertas por encima del precio actual:
    for (const openSell of this.activeSellOrders) {
      if (openSell.price > currentPrice * 1.005) {
        // Mover a la bóveda legacy sin cancelar la orden límite alta en Binance
        this.legacyVault.push({
          orderId: openSell.orderId,
          price: openSell.price,
          amount: openSell.amount
        });
      }
    }
    // 3. Sembrar la nueva grilla con el BTC y USDT libre remanente
  }
}
```

#### B. Soporte para Grilla de Doble Capa (Micro/Macro) & Take-Profit Asimétrico
```typescript
// Al sembrar la grilla:
const microRatio = Number(process.env.MICRO_CAPITAL_RATIO || 0.25);
const microRange = Number(process.env.MICRO_GRID_RANGE_USD || 2240.00);
const microLevels = Number(process.env.MICRO_GRID_LEVELS || 6);

// Sembrar órdenes Macro (75% capital) y órdenes Micro (25% capital) concurrentes:
// Cuando se ejecuta una compra Micro: se coloca venta Micro a +stepMicro
// Cuando se ejecuta una compra Macro: se coloca venta Macro a +(stepMacro * takeProfitMultiplier)
```

---

## ⚙️ Variables de Entorno `.env` Recomendadas (Doble Capa Campeona)

```bash
# === MACRO GRID PARAMS ===
GRID_LEVELS="9"
ATR_PERIOD="19"
ATR_MULTIPLIER="2.0"
MIN_GRID_RANGE_USD="6996.00"
MAX_GRID_RANGE_USD="8846.00"
PRICE_DRIFT_UPPER_THRESHOLD="0.89"
PRICE_DRIFT_LOWER_THRESHOLD="0.15"
PRICE_DRIFT_COOLDOWN_MINS="38"
CIRCUIT_BREAKER_DROP_PCT="7.4"
CIRCUIT_BREAKER_WINDOW_MINS="29"
FOMO_COOLDOWN_HOURS="11.5"

# === GRILA ASIMÉTRICA & REINVERSIÓN ===
ENABLE_CONTINUOUS_COMPOUNDING="true"
TAKE_PROFIT_MULTIPLIER="1.8"
BUY_CAPITAL_WEIGHT="0.52"

# === MICRO GRID (ALTA FRECUENCIA) ===
ENABLE_DUAL_LAYER="true"
MICRO_CAPITAL_RATIO="0.25"
MICRO_GRID_RANGE_USD="2241.00"
MICRO_GRID_LEVELS="6"
```
