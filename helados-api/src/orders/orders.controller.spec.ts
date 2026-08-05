import { Test } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const mockOrdersService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  cancel: jest.fn(),
};

describe('OrdersController', () => {
  let controller: OrdersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: mockOrdersService }],
    }).compile();
    controller = module.get(OrdersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('passes the authenticated user, id and reason to the service', async () => {
    const req = { user: { sub: 'staff1', role: 'STAFF' } };
    mockOrdersService.cancel.mockResolvedValue({ id: 'order1' });

    await controller.cancel(req, 'order1', { reason: 'REGISTRO_ERRONEO' });

    expect(mockOrdersService.cancel).toHaveBeenCalledWith(
      { sub: 'staff1', role: 'STAFF' },
      'order1',
      'REGISTRO_ERRONEO',
    );
  });

  it('passes the authenticated user to findAll', async () => {
    const req = { user: { sub: 'staff1', role: 'STAFF' } };
    mockOrdersService.findAll.mockResolvedValue([]);

    await controller.findAll(req, {});

    expect(mockOrdersService.findAll).toHaveBeenCalledWith(
      { sub: 'staff1', role: 'STAFF' },
      {},
    );
  });
});
