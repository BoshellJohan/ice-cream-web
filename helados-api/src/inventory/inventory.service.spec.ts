import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotPeriod } from './dto/create-snapshot.dto';

const fakeSnapshot = {
  id: 'snap1', takenBy: 'user1', takenAt: new Date('2026-06-16T08:00:00Z'),
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
  orderItem: {
    groupBy: jest.fn(),
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
      date: '2026-06-16',
      lines: [
        { productType: 'CONE' as const, productSize: 'SMALL', quantity: 5 },
        { productId: 'bev1', quantity: 24 },
        { label: 'Jarabe', quantity: 2 },
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
      expect(mockPrisma.inventorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ takenBy: 'user1', period: 'MORNING' }),
        }),
      );
      expect(result).toEqual(fakeSnapshot);
    });

    it('deletes existing lines, edits, and snapshot before creating new', async () => {
      const existingSnapshot = { id: 'old-snap' };
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.inventorySnapshot.findFirst.mockResolvedValue(existingSnapshot);
      mockPrisma.inventoryLine.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.inventoryEdit.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.inventorySnapshot.delete.mockResolvedValue(existingSnapshot);
      mockPrisma.inventorySnapshot.create.mockResolvedValue(fakeSnapshot);

      await service.upsertSnapshot('user1', dto);

      expect(mockPrisma.inventoryLine.deleteMany).toHaveBeenCalledWith({ where: { snapshotId: 'old-snap' } });
      expect(mockPrisma.inventoryEdit.deleteMany).toHaveBeenCalledWith({ where: { snapshotId: 'old-snap' } });
      expect(mockPrisma.inventorySnapshot.delete).toHaveBeenCalledWith({ where: { id: 'old-snap' } });
    });

    it('creates snapshot lines with productType/productSize/productId/label', async () => {
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
                { productType: 'CONE', productSize: 'SMALL', productId: undefined, label: undefined, quantity: 5 },
                { productType: undefined, productSize: undefined, productId: 'bev1', label: undefined, quantity: 24 },
                { productType: undefined, productSize: undefined, productId: undefined, label: 'Jarabe', quantity: 2 },
              ],
            },
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.inventorySnapshot.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('applies beverage overlay for BEVERAGE lines', async () => {
      const snap = {
        ...fakeSnapshot,
        lines: [{
          id: 'line1', snapshotId: 'snap1',
          productType: null, productSize: null,
          productId: 'bev1', product: { id: 'bev1', name: 'Agua', type: 'BEVERAGE' },
          label: null, quantity: 12,
        }],
      };
      mockPrisma.inventorySnapshot.findUnique.mockResolvedValue(snap);
      mockPrisma.orderItem.groupBy.mockResolvedValue([
        { productId: 'bev1', _count: { id: 3 } },
      ]);

      const result = await service.findOne('snap1') as any;

      expect(result.lines[0].soldSince).toBe(3);
      expect(result.lines[0].remaining).toBe(9);
    });

    it('returns 0 soldSince when no orders found for beverage', async () => {
      const snap = {
        ...fakeSnapshot,
        lines: [{
          id: 'line2', snapshotId: 'snap1',
          productType: null, productSize: null,
          productId: 'bev2', product: { id: 'bev2', name: 'Jugo', type: 'BEVERAGE' },
          label: null, quantity: 6,
        }],
      };
      mockPrisma.inventorySnapshot.findUnique.mockResolvedValue(snap);
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);

      const result = await service.findOne('snap1') as any;

      expect(result.lines[0].soldSince).toBe(0);
      expect(result.lines[0].remaining).toBe(6);
    });

    it('does not add overlay fields to packaging lines', async () => {
      const snap = {
        ...fakeSnapshot,
        lines: [{
          id: 'line3', snapshotId: 'snap1',
          productType: 'CONE', productSize: 'SMALL',
          productId: null, product: null,
          label: null, quantity: 10,
        }],
      };
      mockPrisma.inventorySnapshot.findUnique.mockResolvedValue(snap);
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);

      const result = await service.findOne('snap1') as any;

      expect(result.lines[0].soldSince).toBeUndefined();
      expect(result.lines[0].remaining).toBeUndefined();
    });
  });

  describe('getSnapshots', () => {
    it('returns morning and night snapshots for a date', async () => {
      const morningSnap = { ...fakeSnapshot, period: 'MORNING', lines: [] };
      const nightSnap   = { ...fakeSnapshot, id: 'snap2', period: 'NIGHT', lines: [] };
      mockPrisma.inventorySnapshot.findFirst
        .mockResolvedValueOnce(morningSnap)
        .mockResolvedValueOnce(nightSnap);
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);

      const result = await service.getSnapshots('2026-06-16');

      expect(result.morning?.period).toBe('MORNING');
      expect(result.night?.period).toBe('NIGHT');
    });

    it('returns null for missing snapshots', async () => {
      mockPrisma.inventorySnapshot.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getSnapshots('2026-06-16');

      expect(result.morning).toBeNull();
      expect(result.night).toBeNull();
    });
  });
});
