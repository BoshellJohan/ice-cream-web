import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  login: jest.fn().mockResolvedValue({ accessToken: 'tok', role: 'STAFF', name: 'Staff' }),
  changePassword: jest.fn().mockResolvedValue(undefined),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('login returns token', async () => {
    const result = await controller.login({ email: 'a@b.com', password: 'pass123' });
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('role');
  });

  it('changePassword delegates to service', async () => {
    await controller.changePassword(
      { user: { id: 'uid', role: 'STAFF' } },
      { currentPassword: 'old123', newPassword: 'new123' },
    );
    expect(mockAuthService.changePassword).toHaveBeenCalledWith('uid', {
      currentPassword: 'old123',
      newPassword: 'new123',
    });
  });
});
