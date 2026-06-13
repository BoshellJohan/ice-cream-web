import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  coupon: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const validCoupon = {
  id: 'cid-1',
  code: 'SAVE10',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  maxUses: null,
  usesCount: 0,
  validFrom: null,
  validUntil: null,
  active: true,
};

describe('CouponsService', () => {
  let service: CouponsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CouponsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CouponsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('validate throws 422 for unknown code', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(null);
    await expect(service.validate('BADCODE')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 for inactive coupon', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, active: false });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 when coupon has not started yet', async () => {
    const future = new Date(Date.now() + 86_400_000);
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, validFrom: future });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 for expired coupon', async () => {
    const past = new Date(Date.now() - 86_400_000);
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, validUntil: past });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 when max uses reached', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, maxUses: 5, usesCount: 5 });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate returns discount info for a valid coupon', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(validCoupon);
    const result = await service.validate('SAVE10');
    expect(result).toMatchObject({
      id: 'cid-1',
      code: 'SAVE10',
      discountType: 'PERCENTAGE',
      discountValue: 10,
    });
  });
});
