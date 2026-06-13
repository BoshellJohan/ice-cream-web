import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    service = module.get(PrismaService);
    jest.spyOn(service, '$connect').mockResolvedValue();
    jest.spyOn(service, '$disconnect').mockResolvedValue();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
