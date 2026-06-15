import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';

const mockPrisma = {
  product: { findMany: jest.fn() },
  flavor: { findMany: jest.fn() },
  topping: { findMany: jest.fn() },
  order: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  coupon: { update: jest.fn() },
  $transaction: jest.fn(),
};

const mockCouponsService = { validate: jest.fn() };

const product  = { id: 'p1', name: 'Small Cone', basePrice: 5,   active: true, directSale: false };
const flavor   = { id: 'f1', name: 'Chocolate',  priceModifier: 1, active: true };
const topping1 = { id: 't1', name: 'Oreo',       unitPrice: 0.5, active: true };
const topping2 = { id: 't2', name: 'Sprinkles',  unitPrice: 1,   active: true };

// 1 item: itemTotal = 5+1 = 6; toppings = 0.5×2 + 1×1 = 2; subtotal = 8
const dto = {
  paymentMethod: 'QR' as const,
  items: [{
    productId: 'p1',
    flavorId:  'f1',
    toppings: [
      { toppingId: 't1', quantity: 2 },
      { toppingId: 't2', quantity: 1 },
    ],
  }],
};

const fakeOrder = {
  id: 'order1', staffId: 'staff1', couponId: null, coupon: null,
  staff: { id: 'staff1', name: 'Ana' },
  subtotal: 8, discountAmount: 0, totalAmount: 8, notes: null,
  createdAt: new Date(), items: [],
};

function setupMocks() {
  mockPrisma.product.findMany.mockResolvedValue([product]);
  mockPrisma.flavor.findMany.mockResolvedValue([flavor]);
  mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.order.create.mockResolvedValue(fakeOrder);
}

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: CouponsService, useValue: mockCouponsService },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('calculates correct totals with no coupon', async () => {
      setupMocks();
      await service.create('staff1', dto);
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 0, totalAmount: 8 }),
        }),
      );
    });

    it('applies PERCENTAGE coupon correctly', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'SAVE10', discountType: 'PERCENTAGE', discountValue: 10 });
      mockPrisma.coupon.update.mockResolvedValue({});
      await service.create('staff1', { ...dto, couponCode: 'SAVE10' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 0.8, totalAmount: 7.2 }),
        }),
      );
    });

    it('applies FIXED coupon correctly', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'SAVE3', discountType: 'FIXED', discountValue: 3 });
      mockPrisma.coupon.update.mockResolvedValue({});
      await service.create('staff1', { ...dto, couponCode: 'SAVE3' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 3, totalAmount: 5 }),
        }),
      );
    });

    it('caps FIXED discount at subtotal', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'BIG', discountType: 'FIXED', discountValue: 50 });
      mockPrisma.coupon.update.mockResolvedValue({});
      await service.create('staff1', { ...dto, couponCode: 'BIG' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 8, totalAmount: 0 }),
        }),
      );
    });

    it('throws NotFoundException when product is missing or inactive', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      await expect(service.create('staff1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when flavor is missing or inactive', async () => {
      mockPrisma.product.findMany.mockResolvedValue([product]);
      mockPrisma.flavor.findMany.mockResolvedValue([]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      await expect(service.create('staff1', dto)).rejects.toThrow(NotFoundException);
    });

    it('increments coupon usesCount inside transaction', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'SAVE10', discountType: 'PERCENTAGE', discountValue: 10 });
      mockPrisma.coupon.update.mockResolvedValue({});
      await service.create('staff1', { ...dto, couponCode: 'SAVE10' });
      expect(mockPrisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { usesCount: { increment: 1 } },
      });
    });

    it('does not call coupon.update when no coupon used', async () => {
      setupMocks();
      await service.create('staff1', dto);
      expect(mockPrisma.coupon.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns orders ordered by createdAt desc with no filter', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      await service.findAll({});
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('filters by date range when from/to provided', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      await service.findAll({ from: '2026-06-13', to: '2026-06-13' });
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }) },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
