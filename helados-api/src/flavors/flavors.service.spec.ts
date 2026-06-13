import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FlavorsService } from './flavors.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  flavor: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockFlavor = {
  id: 'fid-1', name: 'Chocolate', priceModifier: 0.5, imageUrl: null, active: true,
};

describe('FlavorsService', () => {
  let service: FlavorsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [FlavorsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(FlavorsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll filters to active by default', async () => {
    mockPrisma.flavor.findMany.mockResolvedValue([mockFlavor]);
    await service.findAll();
    expect(mockPrisma.flavor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('toggleActive flips active flag', async () => {
    mockPrisma.flavor.findUnique.mockResolvedValue(mockFlavor);
    mockPrisma.flavor.update.mockResolvedValue({ ...mockFlavor, active: false });
    await service.toggleActive('fid-1');
    expect(mockPrisma.flavor.update).toHaveBeenCalledWith({
      where: { id: 'fid-1' }, data: { active: false },
    });
  });

  it('toggleActive throws NotFoundException for unknown id', async () => {
    mockPrisma.flavor.findUnique.mockResolvedValue(null);
    await expect(service.toggleActive('bad')).rejects.toBeInstanceOf(NotFoundException);
  });
});
