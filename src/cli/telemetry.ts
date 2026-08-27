import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { calculateAccountEquity, EquitySummary } from '../core/equityCalculator';

const prisma = new PrismaClient();

// ANSI Color & Style Helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

const SEPARATOR = gray('─'.repeat(82));

function renderMultiSegmentBar(
  injectedRatio: number,
  profitRatio: number,
  totalChars: number = 42
): string {
  const injectedChars = Math.max(0, Math.round(injectedRatio * totalChars));
  const profitChars = Math.max(0, Math.round(profitRatio * totalChars));
  const emptyChars = Math.max(0, totalChars - injectedChars - profitChars);

  return (
    blue('█'.repeat(injectedChars)) +
    green('█'.repeat(profitChars)) +
    gray('░'.repeat(emptyChars))
  );
}

function renderSimpleBar(ratio: number, totalChars: number, colorFn: (s: string) => string): string {
  const filled = Math.max(0, Math.min(totalChars, Math.round(ratio * totalChars)));
  const empty = Math.max(0, totalChars - filled);
  return `${colorFn('█'.repeat(filled))}${gray('░'.repeat(empty))}`;
}

type PeriodFilter = 'today' | 'week' | 'month' | 'year' | 'all';

function parsePeriodFilter(args: string[]): { filter: PeriodFilter; label: string; sinceDate?: Date } {
  const now = new Date();
  if (args.includes('--today') || args.includes('-d')) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    return { filter: 'today', label: 'HOY (00:00 UTC a ahora)', sinceDate: today };
  }
  if (args.includes('--week') || args.includes('-w')) {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    return { filter: 'week', label: 'ÚLTIMOS 7 DÍAS', sinceDate: weekAgo };
  }
  if (args.includes('--month') || args.includes('-m')) {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    return { filter: 'month', label: 'ÚLTIMOS 30 DÍAS', sinceDate: monthAgo };
  }
  if (args.includes('--year') || args.includes('-y')) {
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0));
    return { filter: 'year', label: `AÑO ${now.getUTCFullYear()}`, sinceDate: yearStart };
  }
  return { filter: 'all', label: 'HISTÓRICO COMPLETO' };
}

export async function runTelemetry(isWatch: boolean = false, args: string[] = []) {
  try {
    const { label: periodLabel, sinceDate } = parsePeriodFilter(args);

    // 1. Cálculo Unificado de Patrimonio Mark-to-Market
    const eq: EquitySummary = await calculateAccountEquity(prisma, sinceDate);

    // 2. Órdenes Abiertas (Depth DOM)
    const openOrders = await prisma.order.findMany({
      where: { status: 'OPEN' },
      orderBy: { price: 'desc' },
    }).catch(() => []);

    const openBuys = openOrders.filter((o) => o.side === 'BUY');
    const openSells = openOrders.filter((o) => o.side === 'SELL');

    // 3. Fills del período
    const filledWhere: any = { status: 'FILLED' };
    if (sinceDate) {
      filledWhere.updatedAt = { gte: sinceDate };
    }
    const filledOrders = await prisma.order.findMany({
      where: filledWhere,
      select: { price: true, amount: true, fee: true },
    }).catch(() => []);

    const totalPeriodVolume = filledOrders.reduce(
      (acc, f) => acc + Number(f.price) * Number(f.amount),
      0
    );

    // 4. Bóveda Legacy
    const legacyOrders = await prisma.legacyOrder.findMany({
      where: { status: 'OPEN' },
      orderBy: { price: 'desc' },
    }).catch(() => []);

    const legacyList = legacyOrders.map((lo) => {
      const p = Number(lo.price);
      const amt = Number(lo.amount);
      const rescuePct = Math.min(100, Number(((eq.spotBtcPrice / p) * 100).toFixed(1)));
      const distUsd = Math.max(0, p - eq.spotBtcPrice);
      return { price: p, amount: amt, rescuePct, distUsd };
    });

    // Barra de Progreso Multi-Segmentada al Objetivo $30k
    const injectedRatio = eq.injectedBaseCapital / eq.targetGoalUsd;
    const profitRatio = Math.max(0, eq.netRealizedTradingProfit / eq.targetGoalUsd);
    const goalBar = renderMultiSegmentBar(injectedRatio, profitRatio, 44);

    // Proximidades Macro
    const nextMacroSell = openSells[openSells.length - 1];
    const nextMacroBuy = openBuys[0];
    const distToSell = nextMacroSell ? Number(nextMacroSell.price) - eq.spotBtcPrice : 850;
    const distToBuy = nextMacroBuy ? eq.spotBtcPrice - Number(nextMacroBuy.price) : 850;

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    if (isWatch) {
      process.stdout.write('\x1b[2J\x1b[0;0H');
    }

    // RENDERIZADO MINIMALISTA SIN CAJA LATERAL
    console.log();
    console.log(`${bold(cyan('🛸 TELEMETRÍA CUANTITATIVA — BTC/USDT SPOT'))}               ${gray(nowStr)}`);
    console.log(SEPARATOR);

    // SECCIÓN 1: KPIS PRINCIPALES
    console.log(
      `🪙 ${bold('SPOT BTC:')} ${yellow('$' + eq.spotBtcPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' USD')}  │  💰 ${bold('TOTAL EN BINANCE:')} ${green('$' + eq.totalEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' USD')}`
    );
    console.log(
      `📥 ${bold('INYECCIÓN BASE:')} ${blue('$' + eq.injectedBaseCapital.toFixed(2) + ' USD')}  │  📈 ${bold('PROFIT BOT:')} ${eq.netRealizedTradingProfit >= 0 ? green('+$' + eq.netRealizedTradingProfit.toFixed(2)) : red('-$' + Math.abs(eq.netRealizedTradingProfit).toFixed(2))}  │  🚀 ${bold('HODL BTC:')} ${green('+$' + eq.unrealizedFloatingProfit.toFixed(2) + ' USD')}`
    );
    console.log(
      `📅 ${bold('FILTRO:')} ${cyan('[' + periodLabel + ']')}   │  📊 ${bold('VOLUMEN:')} $${totalPeriodVolume.toFixed(0)} USD  │  🔢 ${bold('TRADES:')} ${filledOrders.length}`
    );
    console.log(SEPARATOR);

    // SECCIÓN 2: DESGLOSE DE SALDOS EN SPOT
    console.log(bold(cyan('💼 DESGLOSE SPOT EN BINANCE (VALORIZADO MARK-TO-MARKET):')));
    console.log(
      `  • ${bold('Bitcoin (BTC):')}  ${eq.btcBalance.total.toFixed(5)} BTC (${bold('$' + eq.btcBalance.valueUsd.toFixed(2) + ' USD')}) ${gray('[Free: ' + eq.btcBalance.free.toFixed(5) + ' | En Órdenes: ' + eq.btcBalance.used.toFixed(5) + ']')}`
    );
    console.log(
      `  • ${bold('Dólares (USDT):')} ${bold('$' + eq.usdtBalance.total.toFixed(2) + ' USD')} ${gray('[Free: $' + eq.usdtBalance.free.toFixed(2) + ' | En Órdenes: $' + eq.usdtBalance.used.toFixed(2) + ']')}`
    );
    console.log(
      `  • ${bold('Comisiones BNB:')} ${eq.bnbBalance.total.toFixed(4)} BNB (${bold('$' + eq.bnbBalance.valueUsd.toFixed(2) + ' USD')}) ${green('✓ 25% Descuento Activo')}`
    );
    console.log(SEPARATOR);

    // SECCIÓN 3: ÚNICO OBJETIVO PATRIMONIAL ($30,000 USD)
    console.log(bold(magenta('🏡 OBJETIVO PATRIMONIAL ($30,000 USD — HACIA EL LADRILLO):')));
    console.log(
      `[${goalBar}] ${bold(cyan(eq.progressTowardsGoalPct.toFixed(2) + '%'))} ($${eq.totalEquityUsd.toFixed(0)} / $${eq.targetGoalUsd.toLocaleString()} USD)`
    );
    console.log(
      `  ${dim('Leyenda:')} ${blue('■ Inyección Base ($' + eq.injectedBaseCapital.toFixed(0) + ')')} │ ${green('■ Profit Bot (+$' + eq.netRealizedTradingProfit.toFixed(0) + ')')} │ ${gray('░ Brecha ($' + eq.remainingTowardsGoalUsd.toFixed(0) + ' USD)')}`
    );
    console.log(SEPARATOR);

    // SECCIÓN 4: EJE DE LIQUIDEZ DEPTH DOM
    console.log(bold(yellow('⚡ EJE DE LIQUIDEZ TÁCTICO (DEPTH DOM EN VIVO)')));
    
    // Top 3 ventas
    const topSells = openSells.slice(-3);
    for (const s of topSells) {
      const p = Number(s.price);
      const amt = Number(s.amount);
      const valUsd = p * amt;
      const diff = p - eq.spotBtcPrice;
      console.log(
        `  ${red('▲ VENTA LÍMITE')} ${bold('$' + p.toFixed(2))} (${amt.toFixed(4)} BTC = $${valUsd.toFixed(1)} USD) ${gray('[+$' + diff.toFixed(0) + ' | +' + ((diff / eq.spotBtcPrice) * 100).toFixed(2) + '%]')}`
      );
    }

    // SPOT CENTRAL LIMPIO
    console.log(
      cyan('  ──────────────► ') + bold(yellow('SPOT ACTUAL: $' + eq.spotBtcPrice.toFixed(2) + ' USD')) + cyan(' ◄──────────────')
    );

    // Top 3 compras
    const topBuys = openBuys.slice(0, 3);
    for (const b of topBuys) {
      const p = Number(b.price);
      const amt = Number(b.amount);
      const valUsd = p * amt;
      const diff = eq.spotBtcPrice - p;
      console.log(
        `  ${green('▼ COMPRA LÍMITE')} ${bold('$' + p.toFixed(2))} (${amt.toFixed(4)} BTC = $${valUsd.toFixed(1)} USD) ${gray('[-$' + diff.toFixed(0) + ' | -' + ((diff / eq.spotBtcPrice) * 100).toFixed(2) + '%]')}`
      );
    }

    console.log(SEPARATOR);

    // SECCIÓN 5: ESTRATO BÓVEDA LEGACY & RADAR MACRO
    console.log(bold(blue('🏛️ ESTRATO BÓVEDA LEGACY & RADAR MACRO (75%)')));
    if (legacyList.length === 0) {
      console.log(`  ${green('✓ Bóveda Despejada:')} 100% del capital activo en la grilla dinámica.`);
    } else {
      for (const leg of legacyList.slice(0, 2)) {
        const bar = renderSimpleBar(leg.rescuePct / 100, 16, yellow);
        console.log(
          `  🏛️ Target $${leg.price.toFixed(0)} [${bar}] ${bold(leg.rescuePct.toFixed(1) + '%')} ${gray('(Faltan +$' + leg.distUsd.toFixed(0) + ' USD)')}`
        );
      }
    }
    console.log(
      `  📡 ${bold('Radar Macro:')} Próxima Compra: ${green('-$' + distToBuy.toFixed(0) + ' USD')} │ Próxima Venta: ${red('+$' + distToSell.toFixed(0) + ' USD')}`
    );
    console.log(SEPARATOR);
    console.log();
  } catch (err) {
    console.error('Error ejecutando telemetría:', err);
  } finally {
    if (!isWatch) {
      await prisma.$disconnect();
    }
  }
}

// Ejecución directa si se invoca por CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch') || args.includes('-l');
  if (isWatch) {
    console.log('Iniciando modo Live Watch (Ctrl+C para salir)...');
    runTelemetry(true, args);
    setInterval(() => runTelemetry(true, args), 3000);
  } else {
    runTelemetry(false, args);
  }
}
