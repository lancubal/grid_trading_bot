import { PrismaClient, OrderStatus, OrderSide } from '@prisma/client';
import Decimal from 'decimal.js';

export class StateRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
  }

  /**
   * Guarda o actualiza una configuración dinámica del bot en la BD
   */
  public async setBotConfig(key: string, value: string): Promise<void> {
    await this.prisma.botConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  /**
   * Obtiene el valor de una configuración dinámica en la BD
   */
  public async getBotConfig(key: string): Promise<string | null> {
    const record = await this.prisma.botConfig.findUnique({
      where: { key },
    });
    return record ? record.value : null;
  }

  /**
   * Guarda o actualiza un nivel de la grilla en la BD.
   */
  public async upsertGridLevel(levelIndex: number, price: Decimal, isHolding: boolean = false) {
    const priceDec = new Decimal(price);
    return this.prisma.gridLevel.upsert({
      where: { levelIndex },
      update: {
        price: priceDec,
        isHolding,
      },
      create: {
        levelIndex,
        price: priceDec,
        isHolding,
      },
    });
  }

  /**
   * Obtiene todos los niveles de la grilla registrados con sus respectivas órdenes.
   */
  public async getAllGridLevels() {
    return this.prisma.gridLevel.findMany({
      orderBy: { levelIndex: 'asc' },
      include: { orders: true },
    });
  }

  /**
   * Registra una nueva orden asociada a un nivel de la grilla.
   */
  public async createOrderRecord(data: {
    exchangeId?: string;
    symbol: string;
    side: OrderSide;
    price: Decimal;
    amount: Decimal;
    gridLevelId: number;
    status?: OrderStatus;
    fee?: Decimal;
    feeCurrency?: string;
    feeCost?: Decimal;
  }) {
    return this.prisma.order.create({
      data: {
        exchangeId: data.exchangeId,
        symbol: data.symbol,
        side: data.side,
        price: new Decimal(data.price),
        amount: new Decimal(data.amount),
        gridLevelId: data.gridLevelId,
        status: data.status ?? OrderStatus.PENDING,
        fee: data.fee ? new Decimal(data.fee) : undefined,
        feeCurrency: data.feeCurrency,
        feeCost: data.feeCost ? new Decimal(data.feeCost) : undefined,
      },
    });
  }

  /**
   * Actualiza el estado de una orden buscando por su ID primario de BD
   */
  public async updateOrderStatusById(
    orderId: string,
    status: OrderStatus,
    fee?: Decimal,
    feeCurrency?: string,
    feeCost?: Decimal
  ) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(fee ? { fee: new Decimal(fee) } : {}),
        ...(feeCurrency ? { feeCurrency } : {}),
        ...(feeCost ? { feeCost: new Decimal(feeCost) } : {}),
      },
    });
  }

  /**
   * Actualiza el estado de una orden buscando por su exchangeId (recibido del WebSocket o REST)
   */
  public async updateOrderStatusByExchangeId(
    exchangeId: string,
    status: OrderStatus,
    fee?: Decimal,
    feeCurrency?: string,
    feeCost?: Decimal
  ) {
    return this.prisma.order.update({
      where: { exchangeId },
      data: {
        status,
        ...(fee ? { fee: new Decimal(fee) } : {}),
        ...(feeCurrency ? { feeCurrency } : {}),
        ...(feeCost ? { feeCost: new Decimal(feeCost) } : {}),
      },
    });
  }

  /**
   * Obtiene todas las órdenes que permanecen abiertas o pendientes (para Reconciliación en Arranque)
   */
  public async getOpenOrders() {
    return this.prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.PENDING, OrderStatus.OPEN],
        },
      },
      include: { gridLevel: true },
    });
  }

  /**
   * Obtiene las órdenes filtradas por su estado (ej. FILLED)
   */
  public async getOrdersByStatus(status: OrderStatus) {
    return this.prisma.order.findMany({
      where: { status },
      include: { gridLevel: true },
    });
  }

  /**
   * Obtiene una orden buscando por su exchangeId
   */
  public async getOrderByExchangeId(exchangeId: string) {
    return this.prisma.order.findUnique({
      where: { exchangeId },
      include: { gridLevel: true },
    });
  }

  /**
   * Registra una orden archivada en la Bóveda Legacy
   */
  public async createLegacyOrder(data: {
    exchangeId?: string;
    symbol: string;
    side?: OrderSide;
    price: Decimal;
    amount: Decimal;
    costBasis?: Decimal;
    originalGridLevelId?: number;
    status?: OrderStatus;
  }) {
    return this.prisma.legacyOrder.create({
      data: {
        exchangeId: data.exchangeId,
        symbol: data.symbol,
        side: data.side ?? OrderSide.SELL,
        price: new Decimal(data.price),
        amount: new Decimal(data.amount),
        costBasis: data.costBasis ? new Decimal(data.costBasis) : undefined,
        originalGridLevelId: data.originalGridLevelId,
        status: data.status ?? OrderStatus.OPEN,
      },
    });
  }

  /**
   * Obtiene todas las órdenes archivadas en la Bóveda Legacy que permanecen abiertas en Binance
   */
  public async getOpenLegacyOrders() {
    return this.prisma.legacyOrder.findMany({
      where: { status: OrderStatus.OPEN },
      orderBy: { price: 'asc' },
    });
  }

  /**
   * Actualiza el estado de una orden Legacy buscando por su ID de BD
   */
  public async updateLegacyOrderStatusById(
    id: string,
    status: OrderStatus
  ) {
    return this.prisma.legacyOrder.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Actualiza el estado de una orden Legacy buscando por su exchangeId
   */
  public async updateLegacyOrderStatusByExchangeId(
    exchangeId: string,
    status: OrderStatus,
    fee?: Decimal,
    feeCurrency?: string,
    feeCost?: Decimal
  ) {
    return this.prisma.legacyOrder.update({
      where: { exchangeId },
      data: {
        status,
        ...(fee ? { fee: new Decimal(fee) } : {}),
        ...(feeCurrency ? { feeCurrency } : {}),
        ...(feeCost ? { feeCost: new Decimal(feeCost) } : {}),
      },
    });
  }

  /**
   * Obtiene las órdenes ejecutadas (FILLED) en un rango de fechas
   */
  public async getOrdersFilledInDateRange(startDate: Date, endDate: Date) {
    return this.prisma.order.findMany({
      where: {
        status: OrderStatus.FILLED,
        updatedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { updatedAt: 'asc' },
      include: { gridLevel: true },
    });
  }

  /**
   * Obtiene las órdenes Legacy ejecutadas (FILLED) en un rango de fechas
   */
  public async getLegacyOrdersFilledInDateRange(startDate: Date, endDate: Date) {
    return this.prisma.legacyOrder.findMany({
      where: {
        status: OrderStatus.FILLED,
        updatedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  /**
   * Obtiene una orden Legacy por su exchangeId
   */
  public async getLegacyOrderByExchangeId(exchangeId: string) {
    return this.prisma.legacyOrder.findUnique({
      where: { exchangeId },
    });
  }

  public async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
