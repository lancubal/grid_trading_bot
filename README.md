# 🤖 Bot de Grid Trading para BTC (Bitcoin)

Bot de trading algorítmico autónomo desarrollado en Node.js y TypeScript, especializado en el mercado de Bitcoin (BTC). Diseñado para operar en entornos de alta disponibilidad y aprovechar la volatilidad intradiaria mediante rangos de precios definidos.

---

## 📌 Visión General & Modelo Económico

El objetivo principal de este proyecto es capturar ganancias a través de oscilaciones intradiarias de precio en un rango especificado (por ejemplo, oscilaciones de $3,000 USD en 15 niveles de ~$214 USD).

### 💡 Análisis de Comisiones y Protección de Rentabilidad (Maker vs Taker):

- **Diferencial por Escalón (Gross Spread):** Con un escalón de $214.29 USD en BTC ($64,500 USD), el spread bruto de cada ciclo de compra-venta es del **~0.33%**.
- **Regla Estructural #1: Operar Exclusivamente con Órdenes Maker (Limit):**
  - Las órdenes `LIMIT` califican como **Maker** en el libro de órdenes con comisiones reducidas del **0.05%** por trade (**0.10%** por ciclo completo compra + venta).
  - **Rendimiento Neto Garantizado:** $0.33\% - 0.10\% =$ **+0.233% neto por ciclo completado** (+0.166 USD en cada trade de $71.40 USD).
- **Regla Estructural #2: Prohibición Estricta de Órdenes Taker (A Mercado):**
  - Las órdenes `MARKET` o Taker cobran comisiones de hasta **0.20%** por trade (**0.40%** por ciclo completo).
  - Si el bot enviara órdenes a mercado, el costo de $0.40\%$ superaría el beneficio del $0.33\%$, generando una **pérdida neta del -0.07%**.
  - **Enforcement en Código:** El módulo [`RiskGuard`](file:///home/luna/repos/dayTradingBot/src/core/riskGuard.ts) rechaza automáticamente cualquier orden que no sea explícitamente `type: 'limit'` con un precio mayor a 0.

---

## 🏗️ Arquitectura del Sistema

El sistema utiliza una arquitectura modular y orientada a eventos dividida en tres capas principales:

```mermaid
graph TD
    subgraph Connection Layer
        EA[Exchange Adapter]
        WS[Exchange Streams - WebSockets]
        REST[REST API - Orders]
    end

    subgraph Strategy Layer
        GE[Grid Engine - Core Logic]
        BM[Bootstrapper - Crash Recovery]
        RG[RiskGuard - Maker Enforcement]
    end

    subgraph Persistence Layer
        SM[State Repository]
        DB[(PostgreSQL)]
    end

    WS -->|Real-time Fills| GE
    EA -->|Events: order:filled| GE
    GE -->|Validate Order| RG
    BM -->|Reconcile State| DB
    BM -->|Reconcile Fills| EA
    GE -->|Events: order:create / order:cancel| EA
    GE -->|Events: state:update| SM
    SM -->|Read / Write| DB
    EA -->|Execute REST| REST
```

---

## 📁 Estructura de Directorios

```plaintext
src/
├── config/             # Variables de entorno y validación de configuración de grilla (Zod)
├── core/               # Lógica de negocio pura, Reconciliación y Tests
│   ├── bootstrapper.ts
│   ├── bootstrapper.test.ts
│   ├── gridManager.ts
│   ├── gridManager.test.ts
│   ├── riskGuard.ts
│   └── riskGuard.test.ts
├── exchange/           # Capa de infraestructura externa (CCXT REST Wrapper & WS Streams)
│   ├── adapter.ts
│   ├── streams.ts
│   └── streams.test.ts
├── db/                 # Capa de persistencia (ORM Prisma & Repositorio de Estado)
│   └── repository.ts
├── types/              # Interfaces globales, eventos y esquemas de Zod
└── index.ts            # Punto de entrada (Bootstrapping, Siembra e Integración)
```

---

## 🛠️ Stack Tecnológico & Testing

- **Lenguaje:** TypeScript / Node.js
- **Exchange API:** CCXT (Binance Testnet / Live WS streams gratis).
- **Testing:** Vitest (17/17 tests unitarios pasados).
- **Base de Datos:** PostgreSQL + Prisma ORM.
- **Validación de Datos:** Zod.
- **Manejo de Eventos:** `EventEmitter` (nativo de Node.js).
- **Precisión Numérica:** Decimal.js.
- **Despliegue:** Docker (`Dockerfile` y `docker-compose.yml`).

---

## 🚀 Instalación y Pruebas

### Ejecutar Tests:
```bash
npm test
```

### Compilar Proyecto:
```bash
npm run build
```

### Desarrollo Local:
```bash
npm run dev
```
