import Decimal from 'decimal.js';

export interface OrderNotificationData {
  side: 'BUY' | 'SELL' | 'buy' | 'sell';
  symbol: string;
  amount: Decimal | number;
  price: Decimal | number;
  usdtBalance?: Decimal | number;
  netProfitUsd?: Decimal | number;
  gridLevel?: number;
  feeCurrency?: string;
  feeCost?: Decimal | number;
}

export interface DailySummaryData {
  date: string;
  flipsCompleted: number;
  totalBuyOrders: number;
  totalSellOrders: number;
  netProfitUsd: number;
  totalVolumeUsd: number;
  totalFeesUsd: number;
  btcBalance: number;
  usdtBalance: number;
  totalEquityUsd: number;
  atrValue: number;
  minGridRange: number;
  maxGridRange: number;
  stepSize: number;
  legacyVault: {
    openOrdersCount: number;
    totalBtc: number;
    totalUsdValue: number;
    fillsCompletedYesterday: number;
    recoveredUsdtYesterday: number;
  };
}

export interface AutoInjectionNotificationData {
  amountUsd: number;
  lifetimeAllocationUsd: number;
  maxLifetimeAllocationUsd: number;
  cooldownDays: number;
}

export class SlackNotifier {
  private enabled: boolean;
  private webhookUrl: string;

  constructor(enabled: boolean = true, webhookUrl?: string) {
    this.enabled = enabled;
    this.webhookUrl = webhookUrl || process.env.SLACK_WEBHOOK_URL || '';
  }

  public isEnabled(): boolean {
    return this.enabled && !!this.webhookUrl;
  }

  /**
   * Envía un mensaje en vivo a Slack al ejecutarse una orden (COMPRA o VENTA / Flip)
   */
  public async notifyOrderExecution(data: OrderNotificationData): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const sideUpper = data.side.toUpperCase();
    const amountStr = new Decimal(data.amount).toFixed(6);
    const priceStr = new Decimal(data.price).toFixed(2);
    const symbol = data.symbol;

    let feeText = '';
    if (data.feeCurrency && data.feeCost !== undefined) {
      const feeCostStr = new Decimal(data.feeCost).toFixed(6);
      const isBnb = data.feeCurrency.toUpperCase() === 'BNB';
      feeText = isBnb
        ? ` | 🪙 Fee: *${feeCostStr} BNB* (-25% desc.)`
        : ` | Fee: ${feeCostStr} ${data.feeCurrency}`;
    }

    let text = '';
    if (sideUpper === 'BUY') {
      const usdtStr = data.usdtBalance !== undefined ? `$${new Decimal(data.usdtBalance).toFixed(2)}` : 'N/A';
      text = `🟢 *COMPRA EJECUTADA*: ${amountStr} ${symbol.split('/')[0]} @ $${priceStr} USD | Saldo USDT libre (líquido): ${usdtStr}${feeText}`;
    } else {
      const profitStr = data.netProfitUsd !== undefined ? `+$${new Decimal(data.netProfitUsd).toFixed(2)} USD` : '+$0.08 USD';
      text = `🔴 *VENTA (Flip) EJECUTADA*: ${amountStr} ${symbol.split('/')[0]} @ $${priceStr} USD | Profit Neto: *${profitStr}*${feeText}`;
    }

    return this.sendSlackMessage(text);
  }

  /**
   * Envía el Resumen Diario de Cierre a las 00:00 UTC con métricas reales auditadas y estado de Bóveda Legacy
   */
  public async notifyDailySummary(summary: DailySummaryData): Promise<boolean> {
    if (!this.isEnabled()) return false;

    let legacyText = '';
    if (summary.legacyVault.openOrdersCount > 0 || summary.legacyVault.fillsCompletedYesterday > 0) {
      legacyText =
        `\n\n🏛️ *ESTADO DE LA BÓVEDA LEGACY*\n` +
        `• *Órdenes en Custodia:* ${summary.legacyVault.openOrdersCount} órdenes GTC activas\n` +
        `• *Inventario Retenido:* ${summary.legacyVault.totalBtc.toFixed(6)} BTC (~$${summary.legacyVault.totalUsdValue.toFixed(2)} USD)\n` +
        `• *Ventas Legacy Ejecutadas Ayer:* ${summary.legacyVault.fillsCompletedYesterday} orden(es) (+$${summary.legacyVault.recoveredUsdtYesterday.toFixed(2)} USDT recuperados a caja)`;
    } else {
      legacyText = `\n\n🏛️ *ESTADO DE LA BÓVEDA LEGACY*\n• *Bóveda Vacía:* 0 órdenes retenidas`;
    }

    const text =
      `📊 *REPORTE DE CIERRE DIARIO DE PRODUCCIÓN* (${summary.date})\n\n` +
      `⚡ *ACTIVIDAD DE LA GRILLA ACTIVA (Últimas 24h)*\n` +
      `• *Flips Completados:* ${summary.flipsCompleted} ciclos (${summary.totalBuyOrders} Compras / ${summary.totalSellOrders} Ventas)\n` +
      `• *Ganancia Neta Realizada:* *+$${summary.netProfitUsd.toFixed(2)} USD*\n` +
      `• *Volumen Transaccionado:* $${summary.totalVolumeUsd.toFixed(2)} USD\n` +
      `• *Comisiones Pagadas:* $${summary.totalFeesUsd.toFixed(4)} USD\n` +
      `• *Rango de Grilla:* $${summary.minGridRange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} – $${summary.maxGridRange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD (ATR: $${summary.atrValue.toFixed(2)} | Escalón: $${summary.stepSize.toFixed(2)})\n\n` +
      `💰 *SALDOS REALES EN BINANCE SPOT*\n` +
      `• *USDT Disponible:* $${summary.usdtBalance.toFixed(2)} USDT libre\n` +
      `• *BTC Disponible:* ${summary.btcBalance.toFixed(6)} BTC libre\n` +
      `• *Patrimonio Total Valorizado:* ~$${summary.totalEquityUsd.toFixed(2)} USD` +
      legacyText;

    return this.sendSlackMessage(text);
  }

  /**
   * Notifica cuando el Firewall de Autodefensa realiza un rescate autónomo desde Simple Earn
   */
  public async notifyAutoInjection(data: AutoInjectionNotificationData): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const text =
      `💉 *FIREWALL DE AUTODEFENSA - RESCATE COMPLETO*\n` +
      `• *Monto Transferido:* $${data.amountUsd.toFixed(2)} USDT de Binance Simple Earn Flexible ➔ Spot\n` +
      `• *Capital Total Asignado:* $${data.lifetimeAllocationUsd.toFixed(2)} / $${data.maxLifetimeAllocationUsd.toFixed(2)} USD\n` +
      `• *Cooldown Temporal Activado:* ${data.cooldownDays} días de bloqueo de nuevos rescates`;

    return this.sendSlackMessage(text);
  }

  public async sendSlackMessage(text: string): Promise<boolean> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        console.warn(`[Slack Notifier Warning] Error enviando mensaje Slack (${response.status}):`, await response.text());
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn(`[Slack Notifier Error] Fallo en fetch webhook Slack:`, err.message || err);
      return false;
    }
  }
}
