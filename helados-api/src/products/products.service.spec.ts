import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockProduct = {
  id: 'pid-1', name: 'Small Cone', type: 'CONE', size: 'SMALL',
  basePrice: 2.5, imageUrl: null, active: true, createdAt: new Date(),
};

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll passes active filter for staff', async () => {
    mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
    await service.findAll(false);
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('findAll passes no filter for admin', async () => {
    mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
    await service.findAll(true);
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('toggleActive flips active flag', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
    mockPrisma.product.update.mockResolvedValue({ ...mockProduct, active: false });
    const result = await service.toggleActive('pid-1');
    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: 'pid-1' },
      data: { active: false },
    });
    expect(result.active).toBe(false);
  });

  it('toggleActive throws NotFoundException for unknown id', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    await expect(service.toggleActive('bad')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates product with included topping allowance', async () => {
    const dto = {
      name: 'Container', type: 'CONTAINER' as const, size: 'OZ6' as const,
      basePrice: 7, includedToppingType: 'NORMAL' as const, includedToppingQty: 2,
    };
    mockPrisma.product.create.mockResolvedValue({
      id: 'p2', ...dto, active: true, directSale: false, imageUrl: null, createdAt: new Date(),
    });
    await service.create(dto);
    expect(mockPrisma.product.create).toHaveBeenCalledWith({ data: dto });
  });

  it('creates product with no topping allowance', async () => {
    const dto = { name: 'Small Cone', type: 'CONE' as const, size: 'SMALL' as const, basePrice: 2.5 };
    mockPrisma.product.create.mockResolvedValue({
      id: 'p3', ...dto, active: true, directSale: false, imageUrl: null,
      includedToppingType: null, includedToppingQty: null, createdAt: new Date(),
    });
    await service.create(dto);
    expect(mockPrisma.product.create).toHaveBeenCalledWith({ data: dto });
  });

  it('create BEVERAGE product forces directSale=true', async () => {
    const dto = {
      name: 'Agua Cristal', type: 'BEVERAGE' as const, basePrice: 1.5,
    };
    mockPrisma.product.create.mockResolvedValue({
      id: 'bev1', ...dto, size: null, directSale: true, active: true,
      imageUrl: null, includedToppingType: null, includedToppingQty: null, createdAt: new Date(),
    });
    await service.create(dto);
    const callArgs = mockPrisma.product.create.mock.calls[0][0];
    expect(callArgs.data.directSale).toBe(true);
  });

  it('create CONE with invalid size throws BadRequestException', async () => {
    const dto = { name: 'Cono', type: 'CONE' as const, size: 'OZ4' as any, basePrice: 3 };
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
  });

  it('create CONTAINER with invalid size throws BadRequestException', async () => {
    const dto = { name: 'Envase', type: 'CONTAINER' as const, size: 'SMALL' as any, basePrice: 5 };
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
  });

  it('create BEVERAGE with size throws BadRequestException', async () => {
    const dto = { name: 'Agua', type: 'BEVERAGE' as const, size: 'SMALL' as any, basePrice: 1.5 };
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
  });
});
