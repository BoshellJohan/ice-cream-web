import { Test } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotPeriod } from './dto/create-snapshot.dto';

const fakeSnapshot = {
  id: 'snap1', takenBy: 'user1', takenAt: new Date(),
  period: 'MORNING', notes: null, lines: [], edits: [], user: { id: 'user1', name: 'Ana' },
};

const mockPrisma = {
  inventorySnapshot: {
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  inventoryLine: {
    deleteMany: jest.fn(),
  },
  inventoryEdit: {
    deleteMany: jest.fn(),
    create:     jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(InventoryService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('upsertSnapshot', () => {
    const dto = {
      period: SnapshotPeriod.MORNING,
      date: '2026-06-13',
      lines: [
        { productId: 'p1', quantity: 5 },
        { label: 'Agua',   quantity: 10 },
      ],
    };

    it('creates a new snapshot when none exists for that period+date', async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.inventorySnapshot.findFirst.mockResolvedValue(null);
      mockPrisma.inventorySnapshot.create.mockResolvedValue(fakeSnapshot);

      const result = await service.upsertSnapshot('user1', dto);

      expect(mockPrisma.inventorySnapshot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ period: 'MORNING' }) }),
      );
      expect(mockPrisma.inventoryLine.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.inventorySnapshot.delete).not.toHaveBeenCalled();
      expect(mockPrisma.inventorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ takenBy: 'user1', period: 'MORNING' }),
        }),
      );
      expect(result).toEqual(fakeSnapshot);
    });

    it('deletes existing lines, edits, and snapshot before creating new when one exists', async () => {
      const existingSnapshot = { id: 'old-snap', lines: [] };
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.inventorySnapshot.findFirst.mockResolvedValue(existingSnapshot);
      mockPrisma.inventoryLine.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.inventoryEdit.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.inventorySnapshot.delete.mockResolvedValue(existingSnapshot);
      mockPrisma.inventorySnapshot.create.mockResolvedValue(fakeSnapshot);

      await service.upsertSnapshot('user1', dto);

      expect(mockPrisma.inventoryLine.deleteMany).toHaveBeenCalledWith({
        where: { snapshotId: 'old-snap' },
      });
      expect(mockPrisma.inventoryEdit.deleteMany).toHaveBeenCalledWith({
        where: { snapshotId: 'old-snap' },
      });
      expect(mockPrisma.inventorySnapshot.delete).toHaveBeenCalledWith({
        where: { id: 'old-snap' },
      });
    });

    it('creates snapshot with all provided lines', async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.inventorySnapshot.findFirst.mockResolvedValue(null);
      mockPrisma.inventorySnapshot.create.mockResolvedValue(fakeSnapshot);

      await service.upsertSnapshot('user1', dto);

      expect(mockPrisma.inventorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lines: {
              create: [
                { productId: 'p1', label: undefined, quantity: 5 },
                { productId: undefined, label: 'Agua', quantity: 10 },
              ],
            },
          }),
        }),
      );
    });
  });

  describe('getSnapshots', () => {
    it('returns morning and night snapshots for a date', async () => {
      const morningSnap = { ...fakeSnapshot, period: 'MORNING' };
      const nightSnap   = { ...fakeSnapshot, id: 'snap2', period: 'NIGHT' };
      mockPrisma.inventorySnapshot.findFirst
        .mockResolvedValueOnce(morningSnap)
        .mockResolvedValueOnce(nightSnap);

      const result = await service.getSnapshots('2026-06-13');

      expect(result.morning).toEqual(morningSnap);
      expect(result.night).toEqual(nightSnap);
      expect(mockPrisma.inventorySnapshot.findFirst).toHaveBeenCalledTimes(2);
    });

    it('returns null for missing snapshots', async () => {
      mockPrisma.inventorySnapshot.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getSnapshots('2026-06-13');

      expect(result.morning).toBeNull();
      expect(result.night).toBeNull();
    });
  });
});
