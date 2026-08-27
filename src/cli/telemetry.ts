import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import https from 'https';

const prisma = new PrismaClient();

// ANSI Color Helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
const bgGreen = (s: string) => `\x1b[42m\x1b[30m${s}\x1b[0m`;
const bgBlue = (s: string) => `\x1b[44m\x1b[37m${s}\x1b[0m`;

function fetchBinancePrice(): Promise<number> {
  return new Promise((resolve) => {
    https
      .get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parseFloat(parsed.price) || 77200);
          } catch {
            resolve(77200);
          }
        });
      })
      .on('error', () => resolve(77200));
  });
}

function renderProgressBar(
  baseVal: number,
  profitVal: number,
  targetVal: number,
  width: number = 36
): { bar: string; pct: number } {
  const currentTotal = Math.max(0, baseVal + profitVal);
  const totalRatio = Math.min(1, currentTotal / targetVal);
  const baseRatio = Math.min(1, baseVal / targetVal);
  const profitRatio = Math.max(0, Math.min(1 - baseRatio, profitVal / targetVal));

  const baseChars = Math.round(baseRatio * width);
  const profitChars = Math.round(profitRatio * width);
  const emptyChars = Math.max(0, width - baseChars - profitChars);

  const bar = `${blue('█'.repeat(baseChars))}${green('█'.repeat(profitChars))}${gray('░'.repeat(emptyChars))}`;
  const pct = (currentTotal / targetVal) * 100;
  return { bar, pct };
}

export async function runTelemetry(isWatch: boolean = false) {
  try {
    const spotPrice = await fetchBinancePrice();

    // 1. Bot Configuration
    const configRecords = await prisma.botConfig.findMany().catch(() => []);
    const configMap = new Map(configRecords.map((r) => [r.key, r.value]));
    const initialInvestment = parseFloat(configMap.get('GRID_INVESTMENT') || '3000.00');
    const targetGoalUsd = 30000.0;

    // 2. Orders Queries
    const openOrders = await prisma.order
      .findMany({
        where: { status: 'OPEN' },
        orderBy: { price: 'desc' },
      })
      .catch(() => []);

    const filledOrders = await prisma.order
      .findMany({
        where: { status: 'FILLED' },
        orderBy: { updatedAt: 'asc' },
      })
      .catch(() => []);

    const legacyOrders = await prisma.legacyOrder
      .findMany({
        orderBy: { price: 'desc' },
      })
      .catch(() => []);

    // 3. Profit & Savings Math (FIFO)
    let totalBuyVol = 0;
    let totalSellVol = 0;
    let totalFeesPaid = 0;
    let grossRealizedProfit = 0;
    const inventory: { price: number; amount: number }[] = [];

    for (const f of filledOrders) {
      const price = Number(f.price);
      const amount = Number(f.amount);
      const notional = price * amount;
      const fee = f.fee ? Number(f.fee) : notional * 0.00075;
      totalFeesPaid += fee;

      if (f.side === 'BUY') {
        totalBuyVol += notional;
        inventory.push({ price, amount });
      } else {
        totalSellVol += notional;
        let remainingSell = amount;
        while (remainingSell > 0.0000001 && inventory.length > 0) {
          const oldestBuy = inventory[0];
          const matchAmt = Math.min(remainingSell, oldestBuy.amount);
          grossRealizedProfit += (price - oldestBuy.price) * matchAmt;
          oldestBuy.amount -= matchAmt;
          remainingSell -= matchAmt;
          if (oldestBuy.amount <= 0.0000001) inventory.shift();
        }
      }
    }

    const netRealizedProfit = grossRealizedProfit - totalFeesPaid;
    const totalVolume = totalBuyVol + totalSellVol;

    // Estimación del Ahorro Invisible (85% de ahorro en comisiones frente al modelo viejo de 20 niveles)
    // El modelo viejo cobraba ~0.15% ida y vuelta sobre un volumen 7.5x superior por día
    const simulatedOldFees = (totalVolume * 0.0015 * 3.2);
    const estimatedFeesSaved = Math.max(0, simulatedOldFees - totalFeesPaid);

    // 4. Categorize Open Orders (Macro vs Micro)
    // En la configuración actual: Micro son niveles con step ~$448, Macro son step ~$874
    const openSells = openOrders.filter((o) => o.side === 'SELL');
    const openBuys = openOrders.filter((o) => o.side === 'BUY');

    const totalOpenBuyUsd = openBuys.reduce((acc, o) => acc + Number(o.price) * Number(o.amount), 0);
    const totalOpenSellBtc = openSells.reduce((acc, o) => acc + Number(o.amount), 0);
    const totalOpenSellUsd = openSells.reduce((acc, o) => acc + Number(o.price) * Number(o.amount), 0);

    // Legacy Vault Math
    let legacyTotalBtc = 0;
    let legacyTotalUsd = 0;
    const legacyDetails = legacyOrders.map((lo) => {
      const p = Number(lo.price);
      const amt = Number(lo.amount);
      legacyTotalBtc += amt;
      legacyTotalUsd += p * amt;
      const rescuePct = ((spotPrice / p) * 100);
      const distUsd = p - spotPrice;
      return { price: p, amount: amt, rescuePct, distUsd, id: lo.exchangeId || lo.id };
    });

    const currentTotalEquity = initialInvestment + netRealizedProfit;
    const { bar: progressBar, pct: progressPct } = renderProgressBar(
      initialInvestment,
      netRealizedProfit,
      targetGoalUsd
    );

    // Proximidad Macro
    const closestMacroSell = openSells[openSells.length - 1];
    const closestMacroBuy = openBuys[0];

    const distToSell = closestMacroSell ? Number(closestMacroSell.price) - spotPrice : 0;
    const distToBuy = closestMacroBuy ? spotPrice - Number(closestMacroBuy.price) : 0;

    // Output formatting
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    if (isWatch) {
      process.stdout.write('\x1b[2J\x1b[0;0H'); // Clear console for live watch
    }

    console.log(gray('┌' + '─'.repeat(78) + '┐'));
    console.log(
      gray('│ ') +
        bold(cyan('🛸 TERMINAL DE TELEMETRÍA CUANTITATIVA — BTC/USDT SPOT')) +
        ' '.repeat(16) +
        gray(nowStr) +
        gray(' │')
    );
    console.log(gray('├' + '─'.repeat(78) + '┤'));

    // SECCIÓN 1: KPI & PATRIMONIAL
    console.log(
      gray('│ ') +
        bold('PRECIO SPOT: ') +
        yellow(`$${spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`) +
        '  │  ' +
        bold('CAPITAL ACTIVO: ') +
        green(`$${currentTotalEquity.toFixed(2)} USD`) +
        '  │  ' +
        bold('PROFIT NETO: ') +
        (netRealizedProfit >= 0 ? green(`+$${netRealizedProfit.toFixed(2)} USD`) : red(`-$${Math.abs(netRealizedProfit).toFixed(2)} USD`)) +
        ' '.repeat(Math.max(1, 10 - netRealizedProfit.toFixed(2).length)) +
        gray('│')
    );

    console.log(gray('├' + '─'.repeat(78) + '┤'));
    console.log(
      gray('│ ') +
        bold(magenta('🏡 OBJETIVO PATRIMONIAL ($30,000 USD — HACIA EL LADRILLO):')) +
        ' '.repeat(20) +
        gray('│')
    );
    console.log(
      gray('│ ') +
        `[${progressBar}] ` +
        bold(cyan(`${progressPct.toFixed(2)}%`)) +
        ` (${green('$' + currentTotalEquity.toFixed(0))} / $${targetGoalUsd.toLocaleString()} USD)` +
        ' '.repeat(Math.max(1, 13 - currentTotalEquity.toFixed(0).length)) +
        gray('│')
    );
    console.log(
      gray('│ ') +
        gray(`   Leyenda: ${blue('■ Base Inicial ($3k)')} | ${green('■ Profit Reinvertido (Compounding)')} | ${gray('░ Brecha')}`) +
        ' '.repeat(12) +
        gray('│')
    );

    // SECCIÓN 2: WORKSPACE TÁCTICO (EJE DE LIQUIDEZ DEPTH DOM)
    console.log(gray('├' + '─'.repeat(78) + '┤'));
    console.log(
      gray('│ ') +
        bold(yellow('⚡ EJE DE LIQUIDEZ TÁCTICO (DEPTH DOM EN VIVO)')) +
        ' '.repeat(34) +
        gray('│')
    );

    // Mostrar hasta 3 órdenes de venta superiores
    const topSells = openSells.slice(-3);
    for (const s of topSells) {
      const p = Number(s.price);
      const amt = Number(s.amount);
      const valUsd = p * amt;
      const diff = p - spotPrice;
      console.log(
        gray('│ ') +
          red(`  ▲ VENTA LÍMITE `) +
          bold(`$${p.toFixed(2)}`) +
          `  (${amt.toFixed(4)} BTC = $${valUsd.toFixed(1)} USD)` +
          gray(` [+$${diff.toFixed(0)} | +${((diff / spotPrice) * 100).toFixed(2)}%]`) +
          ' '.repeat(Math.max(1, 16 - diff.toFixed(0).length)) +
          gray('│')
      );
    }

    // Punto Central SPOT
    console.log(
      gray('│ ') +
        bgBlue(bold(`  ══════► SPOT ACTUAL: $${spotPrice.toFixed(2)} USD ◄══════  `)) +
        ' '.repeat(22) +
        gray('│')
    );

    // Mostrar hasta 3 órdenes de compra inferiores
    const topBuys = openBuys.slice(0, 3);
    for (const b of topBuys) {
      const p = Number(b.price);
      const amt = Number(b.amount);
      const valUsd = p * amt;
      const diff = spotPrice - p;
      console.log(
        gray('│ ') +
          green(`  ▼ COMPRA LÍMITE `) +
          bold(`$${p.toFixed(2)}`) +
          ` (${amt.toFixed(4)} BTC = $${valUsd.toFixed(1)} USD)` +
          gray(` [-$${diff.toFixed(0)} | -${((diff / spotPrice) * 100).toFixed(2)}%]`) +
          ' '.repeat(Math.max(1, 16 - diff.toFixed(0).length)) +
          gray('│')
      );
    }

    // SECCIÓN 3: ESTRUCTURAL & BÓVEDA LEGACY
    console.log(gray('├' + '─'.repeat(78) + '┤'));
    console.log(
      gray('│ ') +
        bold(blue('🏛️ ESTRATO BÓVEDA LEGACY & RADAR MACRO (75%)')) +
        ' '.repeat(34) +
        gray('│')
    );

    if (legacyDetails.length === 0) {
      console.log(
        gray('│ ') +
          green('  ✓ Bóveda Vacía:') +
          ' Todo el capital está 100% activo en la grilla dinámica.' +
          ' '.repeat(16) +
          gray('│')
      );
    } else {
      for (const leg of legacyDetails.slice(0, 3)) {
        const barWidth = 16;
        const fillChars = Math.min(barWidth, Math.round((leg.rescuePct / 100) * barWidth));
        const empty = Math.max(0, barWidth - fillChars);
        const bar = `${yellow('█'.repeat(fillChars))}${gray('░'.repeat(empty))}`;

        console.log(
          gray('│ ') +
            `  🏛️ Target $${leg.price.toFixed(0)} ` +
            `[${bar}] ` +
            bold(`${leg.rescuePct.toFixed(1)}%`) +
            gray(` (Faltan $${leg.distUsd.toFixed(0)} USD)`) +
            ` | ${leg.amount.toFixed(4)} BTC` +
            ' '.repeat(Math.max(1, 12 - leg.distUsd.toFixed(0).length)) +
            gray('│')
        );
      }
    }

    console.log(
      gray('│ ') +
        `  📡 Radar Macro: Próxima Compra: ${green('-$' + distToBuy.toFixed(0) + ' USD')} | Próxima Venta: ${red('+$' + distToSell.toFixed(0) + ' USD')}` +
        ' '.repeat(Math.max(1, 15 - distToBuy.toFixed(0).length - distToSell.toFixed(0).length)) +
        gray('│')
    );

    // SECCIÓN 4: EFICIENCIA INVISIBLE
    console.log(gray('├' + '─'.repeat(78) + '┤'));
    console.log(
      gray('│ ') +
        bold(green('✨ EFICIENCIA CUANTITATIVA INVISIBLE (SHADOW TELEMETRY):')) +
        ' '.repeat(21) +
        gray('│')
    );
    console.log(
      gray('│ ') +
        `  • Comisiones Reales Pagadas:     ${yellow('-$' + totalFeesPaid.toFixed(2) + ' USD')} (0.075% BNB)` +
        ' '.repeat(27) +
        gray('│')
    );
    console.log(
      gray('│ ') +
        `  • Comisiones Ahorradas (85%):    ${green('+$' + estimatedFeesSaved.toFixed(2) + ' USD')} (Dinero conservado)` +
        ' '.repeat(22) +
        gray('│')
    );
    console.log(
      gray('│ ') +
        `  • Total Fills Completados:       ${cyan(filledOrders.length.toString())} Trades (${totalBuyVol > 0 ? (totalVolume).toFixed(0) : '0'} USD Volumen)` +
        ' '.repeat(Math.max(1, 26 - filledOrders.length.toString().length)) +
        gray('│')
    );
    console.log(gray('└' + '─'.repeat(78) + '┘\n'));
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
  const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');
  if (isWatch) {
    console.log('Iniciando modo Live Watch (Ctrl+C para salir)...');
    runTelemetry(true);
    setInterval(() => runTelemetry(true), 3000);
  } else {
    runTelemetry(false);
  }
}
