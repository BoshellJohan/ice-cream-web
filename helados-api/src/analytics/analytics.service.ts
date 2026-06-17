import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    const gte = new Date(from);
    const lt  = new Date(to);
    lt.setDate(lt.getDate() + 1);
    return { gte, lt };
  }

  async getSummary(from: string, to: string) {
    const range = this.dateRange(from, to);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: range },
      select: { createdAt: true, totalAmount: true, couponId: true },
    });

    const dailyMap = new Map<string, { total: number; count: number }>();
    let totalRevenue = 0;
    let ordersWithCoupon = 0;

    for (const order of orders) {
      const date  = order.createdAt.toISOString().split('T')[0];
      const entry = dailyMap.get(date) ?? { total: 0, count: 0 };
      entry.total += Number(order.totalAmount);
      entry.count += 1;
      dailyMap.set(date, entry);
      totalRevenue += Number(order.totalAmount);
      if (order.couponId) ordersWithCoupon += 1;
    }

    totalRevenue = Math.round(totalRevenue * 100) / 100;

    const dailyRevenue = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { totalRevenue, totalOrders: orders.length, ordersWithCoupon, dailyRevenue };
  }

  async getTopItems(from: string, to: string) {
    const range = this.dateRange(from, to);

    const [flavorGroups, toppingGroups] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['flavorId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
        where: { order: { createdAt: range } },
      }),
      this.prisma.orderItemTopping.groupBy({
        by: ['toppingId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
        where: { orderItem: { order: { createdAt: range } } },
      }),
    ]);

    const flavorIds = flavorGroups.map(g => g.flavorId).filter((id): id is string => id !== null);

    const [flavors, toppings] = await Promise.all([
      flavorIds.length
        ? this.prisma.flavor.findMany({
            where: { id: { in: flavorIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      toppingGroups.length
        ? this.prisma.topping.findMany({
            where: { id: { in: toppingGroups.map(g => g.toppingId) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const flavorMap  = new Map(flavors.map(f  => [f.id, f.name]  as const));
    const toppingMap = new Map(toppings.map(t => [t.id, t.name] as const));

    return {
      topFlavors:  flavorGroups.filter(g => g.flavorId !== null).map(g => ({ name: flavorMap.get(g.flavorId!)  ?? g.flavorId!,  count: g._count.id })),
      topToppings: toppingGroups.map(g => ({ name: toppingMap.get(g.toppingId) ?? g.toppingId, quantity: g._sum.quantity ?? 0 })),
    };
  }

  async getDaily(date: string) {
    const range = this.dateRange(date, date);

    const [orders, items, payments] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: range } }),
      this.prisma.orderItem.count({ where: { order: { createdAt: range } } }),
      this.prisma.orderPayment.groupBy({
        by: ['paymentMethod'],
        _sum: { amount: true },
        where: { order: { createdAt: range } },
      }),
    ]);

    const cashRevenue  = Number(payments.find(p => p.paymentMethod === 'CASH')?._sum.amount ?? 0);
    const qrRevenue    = Number(payments.find(p => p.paymentMethod === 'QR')?._sum.amount  ?? 0);
    const totalRevenue = Math.round((cashRevenue + qrRevenue) * 100) / 100;

    return { orders, items, totalRevenue, cashRevenue, qrRevenue };
  }

  async getReconciliation(date: string) {
    const record = await this.prisma.dailyReconciliation.findUnique({
      where: { date: new Date(date) },
    });
    if (!record) return null;
    return {
      actualCash: Number(record.actualCash),
      actualQr:   Number(record.actualQr),
      updatedAt:  record.updatedAt.toISOString(),
    };
  }

  async saveReconciliation(date: string, actualCash: number, actualQr: number, userId: string) {
    const record = await this.prisma.dailyReconciliation.upsert({
      where:  { date: new Date(date) },
      create: { date: new Date(date), actualCash, actualQr, updatedBy: userId },
      update: { actualCash, actualQr, updatedBy: userId },
    });
    return {
      actualCash: Number(record.actualCash),
      actualQr:   Number(record.actualQr),
      updatedAt:  record.updatedAt.toISOString(),
    };
  }
}
