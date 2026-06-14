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

    const [flavors, toppings] = await Promise.all([
      flavorGroups.length
        ? this.prisma.flavor.findMany({
            where: { id: { in: flavorGroups.map(g => g.flavorId) } },
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

    const flavorMap  = new Map(flavors.map(f => [f.id, f.name]));
    const toppingMap = new Map(toppings.map(t => [t.id, t.name]));

    return {
      topFlavors:  flavorGroups.map(g  => ({ name: flavorMap.get(g.flavorId)   ?? g.flavorId,  count:    g._count.id })),
      topToppings: toppingGroups.map(g => ({ name: toppingMap.get(g.toppingId) ?? g.toppingId, quantity: g._sum.quantity ?? 0 })),
    };
  }
}
