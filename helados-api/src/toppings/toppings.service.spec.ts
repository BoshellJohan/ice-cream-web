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
  },
};

const mockTopping = {
  id: 'tid-1', name: 'Oreo', unitPrice: 0.75, imageUrl: null, active: true,
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
