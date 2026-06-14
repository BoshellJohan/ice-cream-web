import { Test } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  order: { findMany: jest.fn() },
  orderItem: { groupBy: jest.fn() },
  orderItemTopping: { groupBy: jest.fn() },
  flavor: { findMany: jest.fn() },
  topping: { findMany: jest.fn() },
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSummary', () => {
    it('aggregates total revenue, order count, and coupon usage', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2026-06-13T10:00:00Z'), totalAmount: 8.00, couponId: null },
        { createdAt: new Date('2026-06-13T12:00:00Z'), totalAmount: 5.00, couponId: 'c1' },
        { createdAt: new Date('2026-06-14T11:00:00Z'), totalAmount: 12.50, couponId: null },
      ]);

      const result = await service.getSummary('2026-06-13', '2026-06-14');

      expect(result.totalRevenue).toBeCloseTo(25.5, 2);
      expect(result.totalOrders).toBe(3);
      expect(result.ordersWithCoupon).toBe(1);
    });

    it('groups revenue by day correctly', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2026-06-13T10:00:00Z'), totalAmount: 8.00, couponId: null },
        { createdAt: new Date('2026-06-13T14:00:00Z'), totalAmount: 5.00, couponId: null },
        { createdAt: new Date('2026-06-14T11:00:00Z'), totalAmount: 12.00, couponId: null },
      ]);

      const result = await service.getSummary('2026-06-13', '2026-06-14');

      expect(result.dailyRevenue).toHaveLength(2);
      const june13 = result.dailyRevenue.find(d => d.date === '2026-06-13')!;
      expect(june13.total).toBeCloseTo(13.0, 2);
      expect(june13.count).toBe(2);
    });

    it('returns empty results when no orders in range', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      const result = await service.getSummary('2026-06-13', '2026-06-14');
      expect(result.totalRevenue).toBe(0);
      expect(result.totalOrders).toBe(0);
      expect(result.dailyRevenue).toHaveLength(0);
    });
  });

  describe('getTopItems', () => {
    it('returns top flavors and toppings', async () => {
      mockPrisma.orderItem.groupBy.mockResolvedValue([
        { flavorId: 'f1', _count: { id: 15 } },
        { flavorId: 'f2', _count: { id: 8 } },
      ]);
      mockPrisma.orderItemTopping.groupBy.mockResolvedValue([
        { toppingId: 't1', _sum: { quantity: 30 } },
      ]);
      mockPrisma.flavor.findMany.mockResolvedValue([
        { id: 'f1', name: 'Chocolate' },
        { id: 'f2', name: 'Vainilla' },
      ]);
      mockPrisma.topping.findMany.mockResolvedValue([
        { id: 't1', name: 'Oreo' },
      ]);

      const result = await service.getTopItems('2026-06-13', '2026-06-14');

      expect(result.topFlavors).toEqual([
        { name: 'Chocolate', count: 15 },
        { name: 'Vainilla', count: 8 },
      ]);
      expect(result.topToppings).toEqual([
        { name: 'Oreo', quantity: 30 },
      ]);
    });

    it('returns empty arrays when no order data', async () => {
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);
      mockPrisma.orderItemTopping.groupBy.mockResolvedValue([]);
      mockPrisma.flavor.findMany.mockResolvedValue([]);
      mockPrisma.topping.findMany.mockResolvedValue([]);

      const result = await service.getTopItems('2026-06-13', '2026-06-14');
      expect(result.topFlavors).toHaveLength(0);
      expect(result.topToppings).toHaveLength(0);
    });
  });
});
