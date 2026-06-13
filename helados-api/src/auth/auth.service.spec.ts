import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUser = {
  id: 'uuid-1',
  name: 'Staff',
  email: 'staff@helados.com',
  passwordHash: '$2b$10$hashedpassword',
  role: 'STAFF' as const,
  active: true,
  createdAt: new Date(),
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns null for unknown email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await service.validateUser('x@x.com', 'pass')).toBeNull();
  });

  it('returns null for inactive user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, active: false });
    expect(await service.validateUser('staff@helados.com', 'pass')).toBeNull();
  });

  it('throws UnauthorizedException on bad credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'x@x.com', password: 'bad' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns token and role on valid login', async () => {
    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    const result = await service.login({ email: 'staff@helados.com', password: 'pass' });
    expect(result).toEqual({ accessToken: 'mock.jwt.token', role: 'STAFF', name: 'Staff' });
  });
});
