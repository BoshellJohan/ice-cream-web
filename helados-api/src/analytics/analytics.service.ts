import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { activeOrder, activeOrderRelation } from '../orders/order-filters';

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
      where: activeOrder({ createdAt: range }),
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
        where: activeOrderRelation({ createdAt: range }),
      }),
      this.prisma.orderItemTopping.groupBy({
        by: ['toppingId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
        // OrderItemTopping has no direct `order` relation in the schema —
        // only `orderItem` (which relates to `order`) — so the helper's
        // output must be nested one level deeper here than for OrderItem.
        where: { orderItem: activeOrderRelation({ createdAt: range }) },
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
      this.prisma.order.count({ where: activeOrder({ createdAt: range }) }),
      this.prisma.orderItem.count({ where: activeOrderRelation({ createdAt: range }) }),
      this.prisma.orderPayment.groupBy({
        by: ['paymentMethod'],
        _sum: { amount: true },
        where: activeOrderRelation({ createdAt: range }),
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

  async getReconciliationSummary(from: string, to: string) {
    const range = this.dateRange(from, to);

    const recons = await this.prisma.dailyReconciliation.findMany({
      where: { date: range },
      select: { date: true, actualCash: true, actualQr: true },
    });

    const coveredDays = new Set(recons.map((r: { date: Date }) => r.date.toISOString().split('T')[0]));

    let actualCash = 0;
    let actualQr = 0;
    for (const r of recons) {
      actualCash += Number(r.actualCash);
      actualQr += Number(r.actualQr);
    }

    const payments = await this.prisma.orderPayment.findMany({
      where: activeOrderRelation({ createdAt: range }),
      select: { paymentMethod: true, amount: true, order: { select: { createdAt: true } } },
    });

    let systemCash = 0;
    let systemQr = 0;
    for (const p of payments) {
      const day = p.order.createdAt.toISOString().split('T')[0];
      if (!coveredDays.has(day)) continue;
      if (p.paymentMethod === 'CASH') systemCash += Number(p.amount);
      else if (p.paymentMethod === 'QR') systemQr += Number(p.amount);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    systemCash = round(systemCash);
    systemQr = round(systemQr);
    actualCash = round(actualCash);
    actualQr = round(actualQr);

    const daysInRange = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;

    return {
      daysReconciled: coveredDays.size,
      daysInRange,
      systemCash,
      systemQr,
      systemTotal: round(systemCash + systemQr),
      actualCash,
      actualQr,
      actualTotal: round(actualCash + actualQr),
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
