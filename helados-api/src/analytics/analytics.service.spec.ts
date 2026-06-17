import { Test } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  order:               { findMany: jest.fn(), count: jest.fn() },
  orderItem:           { groupBy: jest.fn(), count: jest.fn() },
  orderItemTopping:    { groupBy: jest.fn() },
  orderPayment:        { groupBy: jest.fn(), findMany: jest.fn() },
  flavor:              { findMany: jest.fn() },
  topping:             { findMany: jest.fn() },
  dailyReconciliation: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
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

  describe('getDaily', () => {
    it('returns counts and revenue split for a day with mixed payments', async () => {
      mockPrisma.order.count.mockResolvedValue(5);
      mockPrisma.orderItem.count.mockResolvedValue(8);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([
        { paymentMethod: 'CASH', _sum: { amount: '40.00' } },
        { paymentMethod: 'QR',   _sum: { amount: '60.50' } },
      ]);

      const result = await service.getDaily('2026-06-15');

      expect(result.orders).toBe(5);
      expect(result.items).toBe(8);
      expect(result.cashRevenue).toBeCloseTo(40.00, 2);
      expect(result.qrRevenue).toBeCloseTo(60.50, 2);
      expect(result.totalRevenue).toBeCloseTo(100.50, 2);
    });

    it('returns all zeros for a day with no orders', async () => {
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.orderItem.count.mockResolvedValue(0);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([]);

      const result = await service.getDaily('2026-06-01');

      expect(result).toEqual({ orders: 0, items: 0, totalRevenue: 0, cashRevenue: 0, qrRevenue: 0 });
    });

    it('returns 0 cashRevenue when only QR payments were used', async () => {
      mockPrisma.order.count.mockResolvedValue(3);
      mockPrisma.orderItem.count.mockResolvedValue(4);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([
        { paymentMethod: 'QR', _sum: { amount: '75.00' } },
      ]);

      const result = await service.getDaily('2026-06-15');

      expect(result.cashRevenue).toBe(0);
      expect(result.qrRevenue).toBeCloseTo(75.00, 2);
      expect(result.totalRevenue).toBeCloseTo(75.00, 2);
    });
  });

  describe('getReconciliation', () => {
    it('returns the saved record with numeric amounts', async () => {
      mockPrisma.dailyReconciliation.findUnique.mockResolvedValue({
        id: 'r1',
        date: new Date('2026-06-15'),
        actualCash: '125.00',
        actualQr: '130.20',
        updatedBy: 'user1',
        updatedAt: new Date('2026-06-15T14:32:00Z'),
      });

      const result = await service.getReconciliation('2026-06-15');

      expect(result).toEqual({
        actualCash: 125.0,
        actualQr: 130.2,
        updatedAt: '2026-06-15T14:32:00.000Z',
      });
    });

    it('returns null when no record exists for the day', async () => {
      mockPrisma.dailyReconciliation.findUnique.mockResolvedValue(null);

      const result = await service.getReconciliation('2026-06-01');

      expect(result).toBeNull();
    });
  });

  describe('getReconciliationSummary', () => {
    it('aggregates system and actual only for days that have reconciliation', async () => {
      // Day 2026-06-15 has reconciliation; 2026-06-16 does not.
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([
        { date: new Date('2026-06-15'), actualCash: '100.00', actualQr: '50.00' },
      ]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: '90.00', order: { createdAt: new Date('2026-06-15T10:00:00Z') } },
        { paymentMethod: 'QR',   amount: '45.00', order: { createdAt: new Date('2026-06-15T12:00:00Z') } },
        { paymentMethod: 'CASH', amount: '999.00', order: { createdAt: new Date('2026-06-16T10:00:00Z') } },
      ]);

      const result = await service.getReconciliationSummary('2026-06-15', '2026-06-16');

      expect(result.systemCash).toBeCloseTo(90.0, 2);
      expect(result.systemQr).toBeCloseTo(45.0, 2);
      expect(result.systemTotal).toBeCloseTo(135.0, 2);
      expect(result.actualCash).toBeCloseTo(100.0, 2);
      expect(result.actualQr).toBeCloseTo(50.0, 2);
      expect(result.actualTotal).toBeCloseTo(150.0, 2);
      expect(result.daysReconciled).toBe(1);
    });

    it('sums per-method across multiple covered days', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([
        { date: new Date('2026-06-15'), actualCash: '100.00', actualQr: '50.00' },
        { date: new Date('2026-06-16'), actualCash: '20.00',  actualQr: '10.00' },
      ]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: '90.00', order: { createdAt: new Date('2026-06-15T10:00:00Z') } },
        { paymentMethod: 'QR',   amount: '45.00', order: { createdAt: new Date('2026-06-15T12:00:00Z') } },
        { paymentMethod: 'CASH', amount: '15.00', order: { createdAt: new Date('2026-06-16T09:00:00Z') } },
      ]);

      const result = await service.getReconciliationSummary('2026-06-15', '2026-06-16');

      expect(result.systemCash).toBeCloseTo(105.0, 2);
      expect(result.systemQr).toBeCloseTo(45.0, 2);
      expect(result.systemTotal).toBeCloseTo(150.0, 2);
      expect(result.actualTotal).toBeCloseTo(180.0, 2);
      expect(result.daysReconciled).toBe(2);
    });

    it('returns zeros and daysReconciled 0 when no reconciliation in range', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: '90.00', order: { createdAt: new Date('2026-06-15T10:00:00Z') } },
      ]);

      const result = await service.getReconciliationSummary('2026-06-15', '2026-06-16');

      expect(result.systemCash).toBe(0);
      expect(result.systemQr).toBe(0);
      expect(result.systemTotal).toBe(0);
      expect(result.actualTotal).toBe(0);
      expect(result.daysReconciled).toBe(0);
    });

    it('computes daysInRange inclusively', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([]);

      const result = await service.getReconciliationSummary('2026-06-11', '2026-06-17');

      expect(result.daysInRange).toBe(7);
    });
  });

  describe('saveReconciliation', () => {
    it('upserts the record and stamps updatedBy in both create and update payloads', async () => {
      mockPrisma.dailyReconciliation.upsert.mockResolvedValue({
        id: 'r1',
        date: new Date('2026-06-15'),
        actualCash: '125.00',
        actualQr: '130.20',
        updatedBy: 'user1',
        updatedAt: new Date('2026-06-15T14:32:00Z'),
      });

      await service.saveReconciliation('2026-06-15', 125.0, 130.2, 'user1');

      expect(mockPrisma.dailyReconciliation.upsert).toHaveBeenCalledWith({
        where: { date: new Date('2026-06-15') },
        create: { date: new Date('2026-06-15'), actualCash: 125.0, actualQr: 130.2, updatedBy: 'user1' },
        update: { actualCash: 125.0, actualQr: 130.2, updatedBy: 'user1' },
      });
    });

    it('returns the saved record with numeric amounts', async () => {
      mockPrisma.dailyReconciliation.upsert.mockResolvedValue({
        id: 'r1',
        date: new Date('2026-06-15'),
        actualCash: '125.00',
        actualQr: '130.20',
        updatedBy: 'user1',
        updatedAt: new Date('2026-06-15T14:32:00Z'),
      });

      const result = await service.saveReconciliation('2026-06-15', 125.0, 130.2, 'user1');

      expect(result).toEqual({
        actualCash: 125.0,
        actualQr: 130.2,
        updatedAt: '2026-06-15T14:32:00.000Z',
      });
    });
  });
});
