import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ToppingsService } from './toppings.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  topping: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  toppingTypeConfig: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const normalConfig = { type: 'NORMAL', unitPrice: 1.00 };
const premiumConfig = { type: 'PREMIUM', unitPrice: 2.00 };

const mockTopping = {
  id: 'tid-1', name: 'Oreo', type: 'NORMAL', customPrice: null, unitPrice: 1.00, imageUrl: null, active: true,
};

describe('ToppingsService', () => {
  let service: ToppingsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ToppingsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ToppingsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll filters to active by default', async () => {
    mockPrisma.topping.findMany.mockResolvedValue([mockTopping]);
    await service.findAll();
    expect(mockPrisma.topping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('getTypeConfigs returns all configs', async () => {
    mockPrisma.toppingTypeConfig.findMany.mockResolvedValue([normalConfig, premiumConfig]);
    const result = await service.getTypeConfigs();
    expect(result).toHaveLength(2);
  });

  it('updateTypeConfig updates config and cascades to toppings without custom price', async () => {
    mockPrisma.toppingTypeConfig.update.mockResolvedValue({ type: 'NORMAL', unitPrice: 1.50 });
    mockPrisma.topping.updateMany.mockResolvedValue({ count: 3 });
    await service.updateTypeConfig('NORMAL', { unitPrice: 1.50 });
    expect(mockPrisma.toppingTypeConfig.update).toHaveBeenCalledWith({
      where: { type: 'NORMAL' },
      data: { unitPrice: 1.50 },
    });
    expect(mockPrisma.topping.updateMany).toHaveBeenCalledWith({
      where: { type: 'NORMAL', customPrice: null },
      data: { unitPrice: 1.50 },
    });
  });

  it('create uses type default price when no customPrice provided', async () => {
    mockPrisma.toppingTypeConfig.findUnique.mockResolvedValue(normalConfig);
    mockPrisma.topping.create.mockResolvedValue(mockTopping);
    await service.create({ name: 'Oreo', type: 'NORMAL' });
    expect(mockPrisma.topping.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unitPrice: 1, customPrice: null }) }),
    );
  });

  it('create uses customPrice when provided', async () => {
    mockPrisma.topping.create.mockResolvedValue({ ...mockTopping, customPrice: 0.5, unitPrice: 0.5 });
    await service.create({ name: 'Oreo', type: 'NORMAL', customPrice: 0.5 });
    expect(mockPrisma.topping.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unitPrice: 0.5, customPrice: 0.5 }) }),
    );
  });

  it('toggleActive flips active flag', async () => {
    mockPrisma.topping.findUnique.mockResolvedValue(mockTopping);
    mockPrisma.topping.update.mockResolvedValue({ ...mockTopping, active: false });
    await service.toggleActive('tid-1');
    expect(mockPrisma.topping.update).toHaveBeenCalledWith({
      where: { id: 'tid-1' }, data: { active: false },
    });
  });

  it('toggleActive throws NotFoundException for unknown id', async () => {
    mockPrisma.topping.findUnique.mockResolvedValue(null);
    await expect(service.toggleActive('bad')).rejects.toBeInstanceOf(NotFoundException);
  });
});
