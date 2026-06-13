import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockUser = {
  id: 'uid-1',
  name: 'Staff',
  email: 'staff@helados.com',
  role: 'STAFF' as const,
  active: true,
  createdAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll returns users without passwordHash', async () => {
    mockPrisma.user.findMany.mockResolvedValue([mockUser]);
    const result = await service.findAll();
    expect(result).toEqual([mockUser]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('create throws ConflictException if email taken', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    await expect(
      service.create({ name: 'X', email: 'staff@helados.com', role: 'STAFF', password: 'pass123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('changeRole throws NotFoundException for unknown user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.changeRole('bad-id', 'ADMIN')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivate throws NotFoundException for unknown user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.deactivate('bad-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
