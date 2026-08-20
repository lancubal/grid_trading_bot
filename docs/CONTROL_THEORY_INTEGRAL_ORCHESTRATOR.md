# 🎛️ Arquitectura de Teoría de Control PID & Orquestador Integral de Régimen de Mercado

Este documento formaliza la correspondencia entre los componentes de nuestro bot de trading algorítmico y la **Teoría Clásica de Control (PID - Proporcional, Integral, Derivativo)**, estableciendo la base de diseño para el futuro **Orquestador Integral de Régimen de Mercado**.

---

## 🎯 Mapeo del Sistema de Control PID

```
                ┌────────────────────────────────────────────────────────┐
                │        ORQUESTADOR INTEGRAL (Macro Regime / I)         │
                │   Acumula señal a largo plazo (Bull / Crab / Bear)     │
                │   Ajusta parámetros base (Levels, MinRange, Multiplier)│
                └───────────────────────────┬────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BUCLE DE CONTROL DINÁMICO                       │
│                                                                        │
│   ┌───────────────────────────────┐  ┌──────────────────────────────┐  │
│   │   CONTROL PROPORCIONAL (P)    │  │   CONTROL DERIVATIVO (D)     │  │
│   │ • ATR Dinámico Instantáneo    │  │ • Cortacircuitos (Velocity)  │  │
│   │ • Reescalado de Grilla        │  │ • FomoGuard (Anti-Pump/Peak) │  │
│   │ • Ponderación por Proximidad  │  │ • Cooldown de Recentrado     │  │
│   └───────────────────────────────┘  └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 1. 🟢 Control Proporcional (P): Reacción al Estado Instantáneo
* **Mecanismo:** El indicador **ATR (Average True Range)** continuo.
* **Función:** Modifica proporcionalmente el ancho de la grilla ($\text{Range} = \text{ATR} \times \text{Multiplier}$) y la separación entre niveles ($\Delta Price$).
* **Propósito:** Si el mercado se comprime, la grilla se comprime; si el mercado se expande, la grilla se expande.

### 2. 🔴 Control Derivativo (D): Reacción a la Tasa de Cambio ($\frac{dP}{dt}$)
* **Mecanismos:** 
  * **Cortacircuitos (*Circuit Breaker*):** Detecta velocidad de caída abrupta ($\frac{\Delta P}{\Delta t} \ge 6.7\%$ en 15 min) y congela compras para no agarrar cuchillos cayendo.
  * **FomoGuard:** Detecta rompimiento parabólico alcista y bloquea el recentrado durante horas para no comprar techos locales.
* **Propósito:** Anticipación y frenado amortiguador ante aceleraciones violentas del precio.

### 3. 🟣 Control Integral (I) / Orquestador de Régimen (Macro Controller)
* **Mecanismo Propuesto:** Clasificador de Régimen de Mercado (Ventana Móvil de 30 a 90 días).
* **Función:** Acumula la tendencia macro (*drift* integral) y clasifica el estado en 4 regímenes:
  1. **Régimen Cangrejo Lateral (*Crab / Mean-Reverting*):** Maximiza `GRID_LEVELS` (18-24), reduce el rango y activa ponderación 1.4x en el centro para exprimir cientos de micro-flips.
  2. **Régimen Tendencia Alcista Fuerte (*Strong Bull*):** Amplía la grilla hacia arriba y reduce el cooldown de recentrado para no quedarse en USDT.
  3. **Régimen Desarme Bajista (*Bear Capitulation*):** Ensancha el rango a $12,000+ USD y activa compras escalonadas con reserva de liquidez.
  4. **Régimen Compresión de Volatilidad (*Squeeze Pre-Breakout*):** Ajusta los escudos D (Circuit Breaker y FOMO) a máxima sensibilidad.

---

## 🚀 Hoja de Ruta de Implementación Futura:
1. **Fase 1 (Actual):** Optimización evolutiva de hiperparámetros P y D sobre datos de 4 años.
2. **Fase 2:** Detector de Regímenes Macro con memoria histórica (filtro de Kalman / medias de largo plazo).
3. **Fase 3:** Orquestador Integral adaptativo en tiempo real en AWS EC2.
