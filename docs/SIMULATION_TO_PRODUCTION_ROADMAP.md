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
| **Grilla Asimétrica Alcista** | Paso de venta = 1.0x $\Delta$ (vende de inmediato en subidas) | **Take-Profit Asimétrico:** Multiplicador $1.7x - 2.0x$ en ventas para dejar correr el rally | `src/core/gridManager.ts` |
| **Arquitectura de Doble Capa** | Una sola grilla rígida | **Micro-Grid ($250 USD step) + Macro-Grid ($1,000 USD step)** concurrentes | `src/core/gridManager.ts` |
| **Orquestador de Régimen** | Comportamiento estático en cualquier mercado | **Control Integral PID:** Detecta Bull/Crab/Bear en ventana 24h/96h y adapta la grilla | `src/core/gridManager.ts` |
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

#### B. Orquestador de Régimen en Tiempo Real (Control Integral)
```typescript
export class GridManager {
  private emaFast24h = 0;
  private emaSlow96h = 0;

  public updateRegime(closePrice1h: number): 'BULL' | 'CRAB' | 'BEAR' {
    const alphaFast = 2 / (24 + 1);
    const alphaSlow = 2 / (96 + 1);
    this.emaFast24h = alphaFast * closePrice1h + (1 - alphaFast) * this.emaFast24h;
    this.emaSlow96h = alphaSlow * closePrice1h + (1 - alphaSlow) * this.emaSlow96h;

    const regimeScorePct = ((this.emaFast24h - this.emaSlow96h) / this.emaSlow96h) * 100;
    const threshold = Number(process.env.REGIME_THRESHOLD_PCT || 1.09);

    if (regimeScorePct >= threshold) return 'BULL';
    if (regimeScorePct <= -threshold) return 'BEAR';
    return 'CRAB';
  }
}
```

---

## ⚙️ Variables de Entorno `.env` Recomendadas (Configuración Definitiva)

```bash
# === MACRO GRID & REGIME ORCHESTRATOR ===
GRID_LEVELS="9"
ATR_PERIOD="8"
ATR_MULTIPLIER="3.2"
MIN_GRID_RANGE_USD="6756.00"
MAX_GRID_RANGE_USD="12953.00"
PRICE_DRIFT_UPPER_THRESHOLD="0.90"
PRICE_DRIFT_LOWER_THRESHOLD="0.11"
PRICE_DRIFT_COOLDOWN_MINS="27"
CIRCUIT_BREAKER_DROP_PCT="6.6"
CIRCUIT_BREAKER_WINDOW_MINS="39"
FOMO_COOLDOWN_HOURS="6.2"

# === GRILA ASIMÉTRICA & REINVERSIÓN ===
ENABLE_CONTINUOUS_COMPOUNDING="true"
TAKE_PROFIT_MULTIPLIER="1.7"
BUY_CAPITAL_WEIGHT="0.50"

# === MICRO GRID (ALTA FRECUENCIA) ===
ENABLE_DUAL_LAYER="true"
MICRO_CAPITAL_RATIO="0.22"
MICRO_GRID_RANGE_USD="2423.00"
MICRO_GRID_LEVELS="5"

# === ORQUESTADOR DE RÉGIMEN (CONTROL INTEGRAL PID) ===
ENABLE_REGIME_ORCHESTRATOR="true"
REGIME_THRESHOLD_PCT="1.09"
```
