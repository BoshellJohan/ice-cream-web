import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
import { UpdateSnapshotDto } from './dto/update-snapshot.dto';
import { activeOrderRelation } from '../orders/order-filters';

const snapshotInclude = {
  lines: {
    include: {
      product: { select: { id: true, name: true, type: true } },
    },
  },
  user:  { select: { id: true, name: true } },
  edits: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { editedAt: 'desc' as const },
  },
} as const;

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async upsertSnapshot(staffId: string, dto: CreateSnapshotDto) {
    const dayStart = new Date(dto.date);
    const dayEnd   = new Date(dto.date);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.inventorySnapshot.findFirst({
        where: { period: dto.period, takenAt: { gte: dayStart, lt: dayEnd } },
      });

      if (existing) {
        await tx.inventoryLine.deleteMany({ where: { snapshotId: existing.id } });
        await tx.inventoryEdit.deleteMany({ where: { snapshotId: existing.id } });
        await tx.inventorySnapshot.delete({ where: { id: existing.id } });
      }

      return tx.inventorySnapshot.create({
        data: {
          takenBy: staffId,
          period:  dto.period,
          notes:   dto.notes,
          lines: {
            create: dto.lines.map(l => ({
              productType: l.productType,
              productSize: l.productSize,
              productId:   l.productId,
              label:       l.label,
              quantity:    l.quantity,
            })),
          },
        },
        include: snapshotInclude,
      });
    });
  }

  async findAll() {
    return this.prisma.inventorySnapshot.findMany({
      orderBy: { takenAt: 'desc' },
      include: {
        user:  { select: { id: true, name: true } },
        edits: { select: { id: true } },
        lines: { select: { id: true } },
      },
    });
  }

  async findOne(id: string) {
    const snapshot = await this.prisma.inventorySnapshot.findUnique({
      where: { id },
      include: snapshotInclude,
    });
    if (!snapshot) throw new NotFoundException(`Inventario ${id} no encontrado`);
    return this.withBeverageOverlay(snapshot);
  }

  async updateSnapshot(id: string, staffId: string, dto: UpdateSnapshotDto) {
    const snapshot = await this.prisma.inventorySnapshot.findUnique({ where: { id } });
    if (!snapshot) throw new NotFoundException(`Inventario ${id} no encontrado`);

    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryLine.deleteMany({ where: { snapshotId: id } });

      await tx.inventorySnapshot.update({
        where: { id },
        data: {
          notes: dto.notes,
          lines: {
            create: dto.lines.map(l => ({
              productType: l.productType,
              productSize: l.productSize,
              productId:   l.productId,
              label:       l.label,
              quantity:    l.quantity,
            })),
          },
        },
      });

      await tx.inventoryEdit.create({
        data: { snapshotId: id, editedBy: staffId, reason: dto.reason },
      });
    });

    const updated = await this.prisma.inventorySnapshot.findUnique({ where: { id }, include: snapshotInclude });
    return this.withBeverageOverlay(updated!);
  }

  async getSnapshots(date: string) {
    const dayStart = new Date(date);
    const dayEnd   = new Date(date);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [morning, night] = await Promise.all([
      this.prisma.inventorySnapshot.findFirst({
        where: { period: 'MORNING', takenAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { takenAt: 'desc' },
        include: snapshotInclude,
      }),
      this.prisma.inventorySnapshot.findFirst({
        where: { period: 'NIGHT', takenAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { takenAt: 'desc' },
        include: snapshotInclude,
      }),
    ]);

    return {
      morning: morning ? await this.withBeverageOverlay(morning) : null,
      night:   night   ? await this.withBeverageOverlay(night)   : null,
    };
  }

  private async withBeverageOverlay<T extends { takenAt: Date; lines: Array<{ productId: string | null; quantity: unknown }> }>(snapshot: T) {
    const beverageLines = snapshot.lines.filter(l => l.productId);
    if (beverageLines.length === 0) return snapshot;

    const soldCounts = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      _count: { id: true },
      where: {
        productId: { in: beverageLines.map(l => l.productId as string) },
        ...activeOrderRelation({ createdAt: { gte: snapshot.takenAt } }),
      },
    });

    const soldMap = new Map(soldCounts.map(g => [g.productId as string, g._count.id]));

    return {
      ...snapshot,
      lines: snapshot.lines.map(l => {
        if (!l.productId) return l;
        const sold = soldMap.get(l.productId) ?? 0;
        return { ...l, soldSince: sold, remaining: Number(l.quantity) - sold };
      }),
    };
  }
}
