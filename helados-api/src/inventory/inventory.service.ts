import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';

const snapshotInclude = {
  lines: {
    include: {
      flavor:  { select: { id: true, name: true } },
      topping: { select: { id: true, name: true } },
    },
  },
  user: { select: { id: true, name: true } },
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
        where: {
          period:  dto.period,
          takenAt: { gte: dayStart, lt: dayEnd },
        },
      });

      if (existing) {
        await tx.inventoryLine.deleteMany({ where: { snapshotId: existing.id } });
        await tx.inventorySnapshot.delete({ where: { id: existing.id } });
      }

      return tx.inventorySnapshot.create({
        data: {
          takenBy: staffId,
          period:  dto.period,
          notes:   dto.notes,
          lines: {
            create: dto.lines.map(l => ({
              flavorId:  l.flavorId,
              toppingId: l.toppingId,
              quantity:  l.quantity,
            })),
          },
        },
        include: snapshotInclude,
      });
    });
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

    return { morning, night };
  }
}
