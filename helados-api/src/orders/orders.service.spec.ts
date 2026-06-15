import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
const topping1 = { id: 't1', name: 'Oreo',       unitPrice: 0.5, active: true, type: 'NORMAL' };
const topping2 = { id: 't2', name: 'Sprinkles',  unitPrice: 1,   active: true, type: 'NORMAL' };
const topping3 = { id: 't3', name: 'Caramel',    unitPrice: 2,   active: true, type: 'PREMIUM' };
const productWithAllowance = {
  id: 'p2', name: 'Container', basePrice: 7, active: true, directSale: false,
  includedToppingType: 'NORMAL', includedToppingQty: 2,
};
const flavor2 = { id: 'f2', name: 'Vanilla', priceModifier: 0, active: true };

// subtotal = 5+1 (base+modifier) + 0.5×2+1×1 (toppings) = 8
const dto = {
  payments: [{ method: 'QR' as const, amount: 8 }],
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
  payments: [{ id: 'pay1', orderId: 'order1', paymentMethod: 'QR', amount: 8 }],
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
      // totalAmount after 10% = 7.2 → payment must match
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 7.2 }], couponCode: 'SAVE10' });
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
      // totalAmount after $3 off = 5 → payment must match
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 5 }], couponCode: 'SAVE3' });
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
      // totalAmount capped at 0 → payment must match
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 0 }], couponCode: 'BIG' });
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
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 7.2 }], couponCode: 'SAVE10' });
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

    it('toppings within NORMAL allowance are free', async () => {
      mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor2]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.order.create.mockResolvedValue(fakeOrder);
      // basePrice=7, priceModifier=0, 2 NORMAL included, 2 NORMAL selected → subtotal=7
      await service.create('staff1', {
        payments: [{ method: 'QR' as const, amount: 7 }],
        items: [{ productId: 'p2', flavorId: 'f2', toppings: [{ toppingId: 't1', quantity: 1 }, { toppingId: 't2', quantity: 1 }] }],
      });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtotal: 7, totalAmount: 7 }) }),
      );
    });

    it('toppings beyond NORMAL allowance are charged', async () => {
      mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor2]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.order.create.mockResolvedValue(fakeOrder);
      // t1 qty=2 consumes 2 free; t2 qty=1 charged 1×1=1 → subtotal=8
      await service.create('staff1', {
        payments: [{ method: 'QR' as const, amount: 8 }],
        items: [{ productId: 'p2', flavorId: 'f2', toppings: [{ toppingId: 't1', quantity: 2 }, { toppingId: 't2', quantity: 1 }] }],
      });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtotal: 8, totalAmount: 8 }) }),
      );
    });

    it('PREMIUM toppings are charged when product includes NORMAL', async () => {
      mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor2]);
      mockPrisma.topping.findMany.mockResolvedValue([topping3]);
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.order.create.mockResolvedValue(fakeOrder);
      // PREMIUM charged 1×2=2 → subtotal=9
      await service.create('staff1', {
        payments: [{ method: 'QR' as const, amount: 9 }],
        items: [{ productId: 'p2', flavorId: 'f2', toppings: [{ toppingId: 't3', quantity: 1 }] }],
      });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtotal: 9, totalAmount: 9 }) }),
      );
    });

    it('stores unitPriceAtSale on each OrderItemTopping at time of order creation', async () => {
      setupMocks();
      await service.create('staff1', dto);
      const createCall = mockPrisma.order.create.mock.calls[0][0];
      const toppingsCreated = createCall.data.items.create[0].toppings.create;
      expect(toppingsCreated).toEqual([
        { toppingId: 't1', quantity: 2, unitPriceAtSale: 0.5 },
        { toppingId: 't2', quantity: 1, unitPriceAtSale: 1 },
      ]);
    });

    // ── NEW TESTS ──────────────────────────────────────────────────────────────

    it('rejects duplicate payment methods', async () => {
      setupMocks();
      await expect(
        service.create('staff1', {
          ...dto,
          payments: [{ method: 'QR' as const, amount: 4 }, { method: 'QR' as const, amount: 4 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when payment amounts do not sum to totalAmount', async () => {
      setupMocks();
      await expect(
        service.create('staff1', {
          ...dto,
          payments: [{ method: 'QR' as const, amount: 5 }], // subtotal is 8, not 5
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts two payments summing to totalAmount', async () => {
      setupMocks();
      await service.create('staff1', {
        ...dto,
        payments: [{ method: 'QR' as const, amount: 5 }, { method: 'CASH' as const, amount: 3 }],
      });
      const createCall = mockPrisma.order.create.mock.calls[0][0];
      expect(createCall.data.payments.create).toEqual([
        { paymentMethod: 'QR',   amount: 5 },
        { paymentMethod: 'CASH', amount: 3 },
      ]);
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
