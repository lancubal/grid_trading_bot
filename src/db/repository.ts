import { PrismaClient, OrderStatus, OrderSide } from '@prisma/client';
import Decimal from 'decimal.js';

export class StateRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
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
      },
    });
  }

  /**
   * Actualiza el estado de una orden buscando por su ID primario de BD
   */
  public async updateOrderStatusById(
    orderId: string,
    status: OrderStatus,
    fee?: Decimal
  ) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(fee ? { fee: new Decimal(fee) } : {}),
      },
    });
  }

  /**
   * Actualiza el estado de una orden buscando por su exchangeId (recibido del WebSocket o REST)
   */
  public async updateOrderStatusByExchangeId(
    exchangeId: string,
    status: OrderStatus,
    fee?: Decimal
  ) {
    return this.prisma.order.update({
      where: { exchangeId },
      data: {
        status,
        ...(fee ? { fee: new Decimal(fee) } : {}),
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

  public async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
