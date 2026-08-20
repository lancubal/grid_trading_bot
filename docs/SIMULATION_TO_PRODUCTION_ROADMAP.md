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
| **Grilla Asimétrica Alcista** | Paso de venta = 1.0x $\Delta$ (vende de inmediato en subidas) | **Take-Profit Asimétrico:** Multiplicador $1.2x - 2.0x$ en ventas para dejar correr el rally | `src/core/gridManager.ts` |
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

#### B. Take-Profit Asimétrico y Ponderación por Proximidad
```typescript
// Al ejecutarse una orden de compra:
const takeProfitMultiplier = Number(process.env.TAKE_PROFIT_MULTIPLIER || 1.0);
const sellFlipPrice = buyFilledOrder.price + (this.currentStepSize * takeProfitMultiplier);

await this.exchange.placeOrder({
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'LIMIT',
  price: sellFlipPrice,
  quantity: buyFilledOrder.amount
});
```

---

## ⚙️ Variables de Entorno `.env` a Incorporar en Producción

```bash
# === OPTIMIZACIÓN EVOLUTIVA VALIDADA ===
GRID_LEVELS="11"
ATR_PERIOD="14"
ATR_MULTIPLIER="4.6"
MIN_GRID_RANGE_USD="6982.00"
MAX_GRID_RANGE_USD="13740.00"
PRICE_DRIFT_UPPER_THRESHOLD="0.90"
PRICE_DRIFT_LOWER_THRESHOLD="0.17"
PRICE_DRIFT_COOLDOWN_MINS="47"
CIRCUIT_BREAKER_DROP_PCT="5.8"
CIRCUIT_BREAKER_WINDOW_MINS="28"
FOMO_COOLDOWN_HOURS="7.2"

# === GRILA ASIMÉTRICA & REINVERSIÓN ===
ENABLE_CONTINUOUS_COMPOUNDING="true"
TAKE_PROFIT_MULTIPLIER="1.5"
BUY_CAPITAL_WEIGHT="0.60"
```
