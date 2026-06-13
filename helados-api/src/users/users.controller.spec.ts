import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockService = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 'uid', name: 'X', email: 'x@x.com', role: 'STAFF', active: true }),
  changeRole: jest.fn().mockResolvedValue({ id: 'uid', role: 'ADMIN' }),
  deactivate: jest.fn().mockResolvedValue({ id: 'uid', active: false }),
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockService }],
    }).compile();
    controller = module.get(UsersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll delegates to service', async () => {
    await controller.findAll();
    expect(mockService.findAll).toHaveBeenCalled();
  });

  it('create delegates to service', async () => {
    await controller.create({ name: 'X', email: 'x@x.com', role: 'STAFF', password: 'pass123' });
    expect(mockService.create).toHaveBeenCalled();
  });

  it('changeRole delegates to service', async () => {
    await controller.changeRole('uid', { role: 'ADMIN' });
    expect(mockService.changeRole).toHaveBeenCalledWith('uid', 'ADMIN');
  });

  it('deactivate delegates to service', async () => {
    await controller.deactivate('uid');
    expect(mockService.deactivate).toHaveBeenCalledWith('uid');
  });
});
