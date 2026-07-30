import Decimal from 'decimal.js';

export interface OrderNotificationData {
  side: 'BUY' | 'SELL' | 'buy' | 'sell';
  symbol: string;
  amount: Decimal | number;
  price: Decimal | number;
  usdtBalance?: Decimal | number;
  netProfitUsd?: Decimal | number;
  gridLevel?: number;
}

export interface DailySummaryData {
  date: string;
  flipsCompleted: number;
  netProfitUsd: number;
  totalVolumeUsd: number;
  totalFeesUsd: number;
  btcBalance: number;
  usdtBalance: number;
  atrValue: number;
  minGridRange: number;
  maxGridRange: number;
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

    let text = '';
    if (sideUpper === 'BUY') {
      const usdtStr = data.usdtBalance !== undefined ? `$${new Decimal(data.usdtBalance).toFixed(2)}` : 'N/A';
      text = `🟢 *COMPRA EJECUTADA*: ${amountStr} ${symbol.split('/')[0]} @ $${priceStr} USD | Saldo USDT: ${usdtStr}`;
    } else {
      const profitStr = data.netProfitUsd !== undefined ? `+$${new Decimal(data.netProfitUsd).toFixed(2)} USD` : '+$1.50 USD (Est.)';
      text = `🔴 *VENTA (Flip) EJECUTADA*: ${amountStr} ${symbol.split('/')[0]} @ $${priceStr} USD | Profit Neto: *${profitStr}*`;
    }

    return this.sendSlackMessage(text);
  }

  /**
   * Envía el Resumen Diario de Cierre a las 00:00 UTC
   */
  public async notifyDailySummary(summary: DailySummaryData): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const text =
      `📊 *REPORTE DE CIERRE DIARIO DE PRODUCCIÓN* (${summary.date})\n` +
      `• *Flips Completados Hoy:* ${summary.flipsCompleted} ciclos\n` +
      `• *Ganancia Neta Realizada:* *+$${summary.netProfitUsd.toFixed(2)} USD*\n` +
      `• *Volumen Transaccionado:* $${summary.totalVolumeUsd.toFixed(2)} USD\n` +
      `• *Comisiones Maker Pagadas:* $${summary.totalFeesUsd.toFixed(4)} USD\n` +
      `• *Balances Actuales:* ${summary.btcBalance.toFixed(4)} BTC | $${summary.usdtBalance.toFixed(2)} USDT\n` +
      `• *Estado Volatilidad ATR:* $${summary.atrValue.toFixed(2)} USD (Rango: $${summary.minGridRange.toLocaleString()} - $${summary.maxGridRange.toLocaleString()})`;

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

  private async sendSlackMessage(text: string): Promise<boolean> {
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
