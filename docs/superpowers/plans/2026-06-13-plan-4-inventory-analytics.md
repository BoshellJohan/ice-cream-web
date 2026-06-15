# Plan 4: Inventory Snapshots & Analytics Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add morning/night inventory snapshots (with upsert — manager can update the morning count after restocking) and an analytics dashboard showing daily revenue, order counts, and top-selling flavors/toppings.

**Architecture:**
- `InventoryModule` — `POST /inventory/snapshots` upserts (delete-and-recreate inside a transaction) the snapshot for a given period+date; `GET /inventory/snapshots?date=` returns `{ morning, night }` for comparison. Morning snapshot CAN be replaced at any time during the day because the manager may restock supplies and re-count.
- `AnalyticsModule` — `GET /analytics/summary?from=&to=` returns daily revenue aggregated in JavaScript (avoids raw SQL); `GET /analytics/top-items?from=&to=` returns top 5 flavors and toppings via Prisma `groupBy`. Both endpoints are ADMIN-only.
- Angular Inventory page: two period tabs (MORNING / NIGHT), date picker, form with all active flavors + toppings and their qty inputs, delta table when both snapshots exist.
- Angular Dashboard page: date-range filter, summary KPI cards, daily revenue table, top-items bar charts rendered in Tailwind (no charting library).

**Tech Stack:** NestJS 11 + Prisma 5 (`$transaction`, `groupBy`); Angular 18 standalone + `forkJoin` + Tailwind CSS.

---

## Prisma schema status

**Already done in Plan 1.** `InventorySnapshot`, `InventoryLine`, and `SnapshotPeriod` enum are in `schema.prisma` and migrated. No schema changes needed.

Key field shapes:
```
InventorySnapshot: id, takenBy (userId), takenAt (DateTime, default now()), period (MORNING|NIGHT), notes?, lines[]
InventoryLine: id, snapshotId, flavorId?, toppingId?, quantity (Decimal)
```

---

## File Map

### helados-api/src/
```
inventory/
  dto/create-snapshot.dto.ts
  dto/get-snapshots-query.dto.ts
  inventory.service.ts
  inventory.service.spec.ts
  inventory.controller.ts
  inventory.module.ts

analytics/
  dto/analytics-query.dto.ts
  analytics.service.ts
  analytics.service.spec.ts
  analytics.controller.ts
  analytics.module.ts
```
Modify: `helados-api/src/app.module.ts`

### helados-ui/src/app/
```
core/
  models/
    inventory.model.ts      (create)
    analytics.model.ts      (create)
  services/
    inventory.service.ts    (create)
    analytics.service.ts    (create)

features/
  inventory/
    inventory.component.ts      (replace Plan 4 stub)
    inventory.component.html    (create)
  analytics/
    dashboard/
      dashboard.component.ts    (replace Plan 4 stub)
      dashboard.component.html  (create)
```

---

## Task 1: NestJS InventoryService — DTOs + upsert logic + tests

**Files:**
- Create: `helados-api/src/inventory/dto/create-snapshot.dto.ts`
- Create: `helados-api/src/inventory/dto/get-snapshots-query.dto.ts`
- Create: `helados-api/src/inventory/inventory.service.ts`
- Create: `helados-api/src/inventory/inventory.service.spec.ts`

**Context:** ADMIN-only. The upsert pattern: find the existing snapshot for (period, date), delete its lines, delete the snapshot, then create a fresh snapshot with new lines — all in a `$transaction`. No Prisma cascade delete is configured, so lines must be deleted before the snapshot. The user's key requirement: **the morning snapshot can be re-saved any number of times during the day** as the manager restocks; the latest save wins.

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/inventory/dto/create-snapshot.dto.ts`:
```typescript
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum SnapshotPeriod {
  MORNING = 'MORNING',
  NIGHT = 'NIGHT',
}

export class InventoryLineDto {
  @IsOptional()
  @IsUUID()
  flavorId?: string;

  @IsOptional()
  @IsUUID()
  toppingId?: string;

  @IsNumber()
  @Min(0)
  quantity: number;
}

export class CreateSnapshotDto {
  @IsEnum(SnapshotPeriod)
  period: SnapshotPeriod;

  @IsDateString()
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryLineDto)
  lines: InventoryLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
```

Create `helados-api/src/inventory/dto/get-snapshots-query.dto.ts`:
```typescript
import { IsDateString } from 'class-validator';

export class GetSnapshotsQueryDto {
  @IsDateString()
  date: string;
}
```

- [ ] **Step 2: Write failing tests**

Create `helados-api/src/inventory/inventory.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotPeriod } from './dto/create-snapshot.dto';

const snapshotInclude = {
  lines: {
    include: {
      flavor:  { select: { id: true, name: true } },
      topping: { select: { id: true, name: true } },
    },
  },
  user: { select: { id: true, name: true } },
};

const fakeSnapshot = {
  id: 'snap1', takenBy: 'user1', takenAt: new Date(),
  period: 'MORNING', notes: null, lines: [], user: { id: 'user1', name: 'Ana' },
};

const mockPrisma = {
  inventorySnapshot: {
    findFirst: jest.fn(),
    create:    jest.fn(),
    delete:    jest.fn(),
  },
  inventoryLine: {
    deleteMany: jest.fn(),
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
        { flavorId: 'f1', quantity: 5 },
        { toppingId: 't1', quantity: 10 },
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

    it('deletes existing lines + snapshot before creating new when one exists', async () => {
      const existingSnapshot = { id: 'old-snap', lines: [] };
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.inventorySnapshot.findFirst.mockResolvedValue(existingSnapshot);
      mockPrisma.inventoryLine.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.inventorySnapshot.delete.mockResolvedValue(existingSnapshot);
      mockPrisma.inventorySnapshot.create.mockResolvedValue(fakeSnapshot);

      await service.upsertSnapshot('user1', dto);

      // Lines must be deleted BEFORE snapshot (foreign key constraint)
      const calls = [
        mockPrisma.inventoryLine.deleteMany.mock.invocationCallOrder[0],
        mockPrisma.inventorySnapshot.delete.mock.invocationCallOrder[0],
        mockPrisma.inventorySnapshot.create.mock.invocationCallOrder[0],
      ];
      expect(calls[0]).toBeLessThan(calls[1]);
      expect(calls[1]).toBeLessThan(calls[2]);

      expect(mockPrisma.inventoryLine.deleteMany).toHaveBeenCalledWith({
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
                { flavorId: 'f1', toppingId: undefined, quantity: 5 },
                { flavorId: undefined, toppingId: 't1', quantity: 10 },
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
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd helados-api
npm test -- --testPathPatterns=inventory.service 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './inventory.service'`

- [ ] **Step 4: Implement InventoryService**

Create `helados-api/src/inventory/inventory.service.ts`:
```typescript
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
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns=inventory.service 2>&1 | tail -10
```

Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add helados-api/src/inventory/
git commit -m "feat: add InventoryService with upsert snapshot (replaces existing for period+date)"
```

---

## Task 2: NestJS InventoryController + Module + AppModule

**Files:**
- Create: `helados-api/src/inventory/inventory.controller.ts`
- Create: `helados-api/src/inventory/inventory.module.ts`
- Modify: `helados-api/src/app.module.ts`

- [ ] **Step 1: Create InventoryController**

Create `helados-api/src/inventory/inventory.controller.ts`:
```typescript
import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InventoryService } from './inventory.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
import { GetSnapshotsQueryDto } from './dto/get-snapshots-query.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Post('snapshots')
  upsert(
    @Request() req: { user: { sub: string } },
    @Body() dto: CreateSnapshotDto,
  ) {
    return this.inventory.upsertSnapshot(req.user.sub, dto);
  }

  @Get('snapshots')
  getSnapshots(@Query() query: GetSnapshotsQueryDto) {
    return this.inventory.getSnapshots(query.date);
  }
}
```

- [ ] **Step 2: Create InventoryModule**

Create `helados-api/src/inventory/inventory.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

@Module({
  providers: [InventoryService],
  controllers: [InventoryController],
})
export class InventoryModule {}
```

- [ ] **Step 3: Register in AppModule**

Modify `helados-api/src/app.module.ts` — add `InventoryModule` import:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';
import { ToppingsModule } from './toppings/toppings.module';
import { CouponsModule } from './coupons/coupons.module';
import { ImagesModule } from './images/images.module';
import { OrdersModule } from './orders/orders.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    FlavorsModule,
    ToppingsModule,
    CouponsModule,
    ImagesModule,
    OrdersModule,
    InventoryModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass (49 existing + 5 inventory = 54 total)

- [ ] **Step 5: Commit**

```bash
git add helados-api/src/inventory/inventory.controller.ts helados-api/src/inventory/inventory.module.ts helados-api/src/app.module.ts
git commit -m "feat: add InventoryController + InventoryModule (POST/GET /inventory/snapshots)"
```

---

## Task 3: NestJS AnalyticsModule — service + tests + controller + module + AppModule

**Files:**
- Create: `helados-api/src/analytics/dto/analytics-query.dto.ts`
- Create: `helados-api/src/analytics/analytics.service.ts`
- Create: `helados-api/src/analytics/analytics.service.spec.ts`
- Create: `helados-api/src/analytics/analytics.controller.ts`
- Create: `helados-api/src/analytics/analytics.module.ts`
- Modify: `helados-api/src/app.module.ts`

**Context:** Revenue aggregation is done in JavaScript (no raw SQL) to stay testable. `groupBy` is used for top flavors and toppings. The date range is inclusive (`from` to end of `to` day).

- [ ] **Step 1: Create DTO**

Create `helados-api/src/analytics/dto/analytics-query.dto.ts`:
```typescript
import { IsDateString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
```

- [ ] **Step 2: Write failing tests**

Create `helados-api/src/analytics/analytics.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  order: { findMany: jest.fn() },
  orderItem: { groupBy: jest.fn() },
  orderItemTopping: { groupBy: jest.fn() },
  flavor: { findMany: jest.fn() },
  topping: { findMany: jest.fn() },
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSummary', () => {
    it('aggregates total revenue, order count, and coupon usage', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2026-06-13T10:00:00Z'), totalAmount: 8.00, couponId: null },
        { createdAt: new Date('2026-06-13T12:00:00Z'), totalAmount: 5.00, couponId: 'c1' },
        { createdAt: new Date('2026-06-14T11:00:00Z'), totalAmount: 12.50, couponId: null },
      ]);

      const result = await service.getSummary('2026-06-13', '2026-06-14');

      expect(result.totalRevenue).toBeCloseTo(25.5, 2);
      expect(result.totalOrders).toBe(3);
      expect(result.ordersWithCoupon).toBe(1);
    });

    it('groups revenue by day correctly', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2026-06-13T10:00:00Z'), totalAmount: 8.00, couponId: null },
        { createdAt: new Date('2026-06-13T14:00:00Z'), totalAmount: 5.00, couponId: null },
        { createdAt: new Date('2026-06-14T11:00:00Z'), totalAmount: 12.00, couponId: null },
      ]);

      const result = await service.getSummary('2026-06-13', '2026-06-14');

      expect(result.dailyRevenue).toHaveLength(2);
      const june13 = result.dailyRevenue.find(d => d.date === '2026-06-13')!;
      expect(june13.total).toBeCloseTo(13.0, 2);
      expect(june13.count).toBe(2);
    });

    it('returns empty results when no orders in range', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      const result = await service.getSummary('2026-06-13', '2026-06-14');
      expect(result.totalRevenue).toBe(0);
      expect(result.totalOrders).toBe(0);
      expect(result.dailyRevenue).toHaveLength(0);
    });
  });

  describe('getTopItems', () => {
    it('returns top flavors and toppings', async () => {
      mockPrisma.orderItem.groupBy.mockResolvedValue([
        { flavorId: 'f1', _count: { id: 15 } },
        { flavorId: 'f2', _count: { id: 8 } },
      ]);
      mockPrisma.orderItemTopping.groupBy.mockResolvedValue([
        { toppingId: 't1', _sum: { quantity: 30 } },
      ]);
      mockPrisma.flavor.findMany.mockResolvedValue([
        { id: 'f1', name: 'Chocolate' },
        { id: 'f2', name: 'Vainilla' },
      ]);
      mockPrisma.topping.findMany.mockResolvedValue([
        { id: 't1', name: 'Oreo' },
      ]);

      const result = await service.getTopItems('2026-06-13', '2026-06-14');

      expect(result.topFlavors).toEqual([
        { name: 'Chocolate', count: 15 },
        { name: 'Vainilla', count: 8 },
      ]);
      expect(result.topToppings).toEqual([
        { name: 'Oreo', quantity: 30 },
      ]);
    });

    it('returns empty arrays when no order data', async () => {
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);
      mockPrisma.orderItemTopping.groupBy.mockResolvedValue([]);
      mockPrisma.flavor.findMany.mockResolvedValue([]);
      mockPrisma.topping.findMany.mockResolvedValue([]);

      const result = await service.getTopItems('2026-06-13', '2026-06-14');
      expect(result.topFlavors).toHaveLength(0);
      expect(result.topToppings).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- --testPathPatterns=analytics.service 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './analytics.service'`

- [ ] **Step 4: Implement AnalyticsService**

Create `helados-api/src/analytics/analytics.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    const gte = new Date(from);
    const lt  = new Date(to);
    lt.setDate(lt.getDate() + 1);
    return { gte, lt };
  }

  async getSummary(from: string, to: string) {
    const range = this.dateRange(from, to);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: range },
      select: { createdAt: true, totalAmount: true, couponId: true },
    });

    const dailyMap = new Map<string, { total: number; count: number }>();
    let totalRevenue = 0;
    let ordersWithCoupon = 0;

    for (const order of orders) {
      const date = order.createdAt.toISOString().split('T')[0];
      const entry = dailyMap.get(date) ?? { total: 0, count: 0 };
      entry.total += Number(order.totalAmount);
      entry.count += 1;
      dailyMap.set(date, entry);
      totalRevenue += Number(order.totalAmount);
      if (order.couponId) ordersWithCoupon += 1;
    }

    totalRevenue = Math.round(totalRevenue * 100) / 100;

    const dailyRevenue = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalRevenue,
      totalOrders: orders.length,
      ordersWithCoupon,
      dailyRevenue,
    };
  }

  async getTopItems(from: string, to: string) {
    const range = this.dateRange(from, to);

    const [flavorGroups, toppingGroups] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['flavorId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
        where: { order: { createdAt: range } },
      }),
      this.prisma.orderItemTopping.groupBy({
        by: ['toppingId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
        where: { orderItem: { order: { createdAt: range } } },
      }),
    ]);

    const [flavors, toppings] = await Promise.all([
      flavorGroups.length
        ? this.prisma.flavor.findMany({
            where: { id: { in: flavorGroups.map(g => g.flavorId) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      toppingGroups.length
        ? this.prisma.topping.findMany({
            where: { id: { in: toppingGroups.map(g => g.toppingId) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const flavorMap  = new Map(flavors.map(f => [f.id, f.name]));
    const toppingMap = new Map(toppings.map(t => [t.id, t.name]));

    return {
      topFlavors: flavorGroups.map(g => ({
        name:  flavorMap.get(g.flavorId) ?? g.flavorId,
        count: g._count.id,
      })),
      topToppings: toppingGroups.map(g => ({
        name:     toppingMap.get(g.toppingId) ?? g.toppingId,
        quantity: g._sum.quantity ?? 0,
      })),
    };
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns=analytics.service 2>&1 | tail -8
```

Expected: PASS — 5 tests

- [ ] **Step 6: Create controller, module, and update AppModule**

Create `helados-api/src/analytics/analytics.controller.ts`:
```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('summary')
  getSummary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getSummary(query.from, query.to);
  }

  @Get('top-items')
  getTopItems(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getTopItems(query.from, query.to);
  }
}
```

Create `helados-api/src/analytics/analytics.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
```

Update `helados-api/src/app.module.ts` to add `AnalyticsModule`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';
import { ToppingsModule } from './toppings/toppings.module';
import { CouponsModule } from './coupons/coupons.module';
import { ImagesModule } from './images/images.module';
import { OrdersModule } from './orders/orders.module';
import { InventoryModule } from './inventory/inventory.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    FlavorsModule,
    ToppingsModule,
    CouponsModule,
    ImagesModule,
    OrdersModule,
    InventoryModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: PASS — 54 existing + 5 analytics = 59 total

- [ ] **Step 8: Commit**

```bash
git add helados-api/src/analytics/ helados-api/src/app.module.ts
git commit -m "feat: add AnalyticsModule (GET /analytics/summary, GET /analytics/top-items)"
```

---

## Task 4: Angular models + services (Inventory + Analytics)

**Files:**
- Create: `helados-ui/src/app/core/models/inventory.model.ts`
- Create: `helados-ui/src/app/core/models/analytics.model.ts`
- Create: `helados-ui/src/app/core/services/inventory.service.ts`
- Create: `helados-ui/src/app/core/services/analytics.service.ts`

**Context:** Same Angular patterns as existing services — `inject()` DI, `environment.apiUrl`, `HttpClient`.

- [ ] **Step 1: Create inventory model**

Create `helados-ui/src/app/core/models/inventory.model.ts`:
```typescript
export type SnapshotPeriod = 'MORNING' | 'NIGHT';

export interface InventoryLine {
  id: string;
  flavorId: string | null;
  flavor: { id: string; name: string } | null;
  toppingId: string | null;
  topping: { id: string; name: string } | null;
  quantity: number;
}

export interface InventorySnapshot {
  id: string;
  takenBy: string;
  user: { id: string; name: string };
  takenAt: string;
  period: SnapshotPeriod;
  notes: string | null;
  lines: InventoryLine[];
}

export interface SnapshotPair {
  morning: InventorySnapshot | null;
  night: InventorySnapshot | null;
}

export interface InventoryLinePayload {
  flavorId?: string;
  toppingId?: string;
  quantity: number;
}

export interface CreateSnapshotPayload {
  period: SnapshotPeriod;
  date: string;
  lines: InventoryLinePayload[];
  notes?: string;
}

export interface DeltaLine {
  label: string;
  morning: number;
  night: number;
  consumed: number; // morning - night (positive = consumed, negative = restocked mid-day)
}
```

- [ ] **Step 2: Create analytics model**

Create `helados-ui/src/app/core/models/analytics.model.ts`:
```typescript
export interface DailyRevenue {
  date: string;
  total: number;
  count: number;
}

export interface SummaryData {
  totalRevenue: number;
  totalOrders: number;
  ordersWithCoupon: number;
  dailyRevenue: DailyRevenue[];
}

export interface TopFlavor {
  name: string;
  count: number;
}

export interface TopTopping {
  name: string;
  quantity: number;
}

export interface TopItemsData {
  topFlavors: TopFlavor[];
  topToppings: TopTopping[];
}
```

- [ ] **Step 3: Create InventoryService**

Create `helados-ui/src/app/core/services/inventory.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CreateSnapshotPayload, InventorySnapshot, SnapshotPair } from '../models/inventory.model';

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/inventory`;

  getSnapshots(date: string) {
    return this.http.get<SnapshotPair>(`${this.url}/snapshots`, { params: { date } });
  }

  upsert(body: CreateSnapshotPayload) {
    return this.http.post<InventorySnapshot>(`${this.url}/snapshots`, body);
  }
}
```

- [ ] **Step 4: Create AnalyticsService**

Create `helados-ui/src/app/core/services/analytics.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { SummaryData, TopItemsData } from '../models/analytics.model';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/analytics`;

  getSummary(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<SummaryData>(`${this.url}/summary`, { params });
  }

  getTopItems(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<TopItemsData>(`${this.url}/top-items`, { params });
  }
}
```

- [ ] **Step 5: Verify build**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -8
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd ..
git add helados-ui/src/app/core/models/inventory.model.ts helados-ui/src/app/core/models/analytics.model.ts helados-ui/src/app/core/services/inventory.service.ts helados-ui/src/app/core/services/analytics.service.ts
git commit -m "feat: add Angular Inventory and Analytics models and services"
```

---

## Task 5: Angular Inventory page

**Files:**
- Modify: `helados-ui/src/app/features/inventory/inventory.component.ts` (replaces stub)
- Create:  `helados-ui/src/app/features/inventory/inventory.component.html`

**Context:** ADMIN-only route (already guarded in app.routes.ts). The page has two uses:
1. **Take snapshot** — select period (MORNING/NIGHT) and date (default today), enter quantities for each active flavor and topping, save
2. **View delta** — when both morning and night snapshots exist for the selected date, show a comparison table: Item | Mañana | Noche | Consumido

The manager workflow for restocking: take morning inventory → manager brings supplies → update morning inventory (save again, overwrites). The backend upserts, so saving again is always safe.

Flavor and topping catalogs are loaded from existing catalog endpoints. The form initializes with zeroed quantities (or pre-fills from existing snapshot if one exists for that period).

- [ ] **Step 1: Replace stub component**

Replace `helados-ui/src/app/features/inventory/inventory.component.ts`:
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { FlavorService } from '../../core/services/flavor.service';
import { ToppingService } from '../../core/services/topping.service';
import { InventoryApiService } from '../../core/services/inventory.service';
import { Flavor } from '../../core/models/flavor.model';
import { Topping } from '../../core/models/topping.model';
import { DeltaLine, InventorySnapshot, SnapshotPeriod } from '../../core/models/inventory.model';

interface QtyRow { id: string; label: string; qty: number; }

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  private flavorSvc   = inject(FlavorService);
  private toppingSvc  = inject(ToppingService);
  private inventorySvc = inject(InventoryApiService);

  selectedDate = new Date().toISOString().split('T')[0];
  selectedPeriod: SnapshotPeriod = 'MORNING';

  flavors:  Flavor[]  = [];
  toppings: Topping[] = [];

  flavorQties:  QtyRow[] = [];
  toppingQties: QtyRow[] = [];

  notes = '';
  saving = false;
  saveSuccess = false;
  saveError = '';

  // Snapshot comparison
  morningSnapshot: InventorySnapshot | null = null;
  nightSnapshot:   InventorySnapshot | null = null;
  delta: DeltaLine[] = [];

  loadingCatalog    = true;
  loadingSnapshots  = false;

  ngOnInit() {
    forkJoin({
      flavors:  this.flavorSvc.getAll(),
      toppings: this.toppingSvc.getAll(),
    }).subscribe({
      next: ({ flavors, toppings }) => {
        this.flavors  = flavors.filter(f => f.active);
        this.toppings = toppings.filter(t => t.active);
        this.loadingCatalog = false;
        this.initForm();
        this.loadSnapshots();
      },
    });
  }

  private initForm(snapshot?: InventorySnapshot | null) {
    const getFlavorQty = (id: string) =>
      snapshot?.lines.find(l => l.flavorId === id)?.quantity ?? 0;
    const getToppingQty = (id: string) =>
      snapshot?.lines.find(l => l.toppingId === id)?.quantity ?? 0;

    this.flavorQties  = this.flavors.map(f  => ({ id: f.id,  label: f.name,  qty: Number(getFlavorQty(f.id))  }));
    this.toppingQties = this.toppings.map(t => ({ id: t.id,  label: t.name,  qty: Number(getToppingQty(t.id)) }));
    this.notes = snapshot?.notes ?? '';
  }

  selectPeriod(period: SnapshotPeriod) {
    this.selectedPeriod = period;
    const snapshot = period === 'MORNING' ? this.morningSnapshot : this.nightSnapshot;
    this.initForm(snapshot);
  }

  loadSnapshots() {
    this.loadingSnapshots = true;
    this.inventorySvc.getSnapshots(this.selectedDate).subscribe({
      next: ({ morning, night }) => {
        this.morningSnapshot = morning;
        this.nightSnapshot   = night;
        this.loadingSnapshots = false;
        // Pre-fill form with existing snapshot for selected period
        const snapshot = this.selectedPeriod === 'MORNING' ? morning : night;
        this.initForm(snapshot);
        this.buildDelta();
      },
      error: () => { this.loadingSnapshots = false; },
    });
  }

  onDateChange() {
    this.saveSuccess = false;
    this.saveError   = '';
    this.loadSnapshots();
  }

  private buildDelta() {
    if (!this.morningSnapshot || !this.nightSnapshot) {
      this.delta = [];
      return;
    }

    const lines: DeltaLine[] = [];

    for (const flavor of this.flavors) {
      const m = Number(this.morningSnapshot.lines.find(l => l.flavorId === flavor.id)?.quantity ?? 0);
      const n = Number(this.nightSnapshot.lines.find(l => l.flavorId === flavor.id)?.quantity ?? 0);
      if (m > 0 || n > 0) {
        lines.push({ label: flavor.name, morning: m, night: n, consumed: m - n });
      }
    }

    for (const topping of this.toppings) {
      const m = Number(this.morningSnapshot.lines.find(l => l.toppingId === topping.id)?.quantity ?? 0);
      const n = Number(this.nightSnapshot.lines.find(l => l.toppingId === topping.id)?.quantity ?? 0);
      if (m > 0 || n > 0) {
        lines.push({ label: topping.name, morning: m, night: n, consumed: m - n });
      }
    }

    this.delta = lines;
  }

  save() {
    this.saving      = true;
    this.saveSuccess = false;
    this.saveError   = '';

    const payload = {
      period: this.selectedPeriod,
      date:   this.selectedDate,
      notes:  this.notes || undefined,
      lines: [
        ...this.flavorQties.map(r => ({ flavorId: r.id, quantity: r.qty })),
        ...this.toppingQties.map(r => ({ toppingId: r.id, quantity: r.qty })),
      ],
    };

    this.inventorySvc.upsert(payload).subscribe({
      next: (snapshot) => {
        this.saving      = false;
        this.saveSuccess = true;
        if (this.selectedPeriod === 'MORNING') this.morningSnapshot = snapshot;
        else                                   this.nightSnapshot   = snapshot;
        this.buildDelta();
      },
      error: (e) => {
        this.saving    = false;
        this.saveError = e?.error?.message ?? 'Error al guardar inventario';
      },
    });
  }

  formatQty(n: number) { return Number(n).toFixed(1); }
}
```

- [ ] **Step 2: Create template**

Create `helados-ui/src/app/features/inventory/inventory.component.html`:
```html
<div class="min-h-screen bg-gray-950 p-5 space-y-6">

  <!-- Header + date picker -->
  <div class="flex flex-wrap items-center gap-4">
    <h1 class="text-2xl font-bold text-white">Inventario</h1>
    <div class="ml-auto flex items-center gap-2">
      <label class="text-gray-400 text-sm">Fecha</label>
      <input
        [(ngModel)]="selectedDate"
        (change)="onDateChange()"
        type="date"
        class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    </div>
  </div>

  @if (loadingCatalog) {
    <p class="text-gray-400">Cargando catálogo...</p>
  } @else {

    <!-- Period tabs -->
    <div class="flex gap-2">
      <button
        (click)="selectPeriod('MORNING')"
        class="px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors touch-manipulation"
        [class.bg-purple-600]="selectedPeriod === 'MORNING'"
        [class.text-white]="selectedPeriod === 'MORNING'"
        [class.bg-gray-800]="selectedPeriod !== 'MORNING'"
        [class.text-gray-400]="selectedPeriod !== 'MORNING'"
      >
        🌅 Inventario Mañana
        @if (morningSnapshot) {
          <span class="ml-2 text-xs opacity-75">{{ morningSnapshot.takenAt | date:'HH:mm' }}</span>
        }
      </button>
      <button
        (click)="selectPeriod('NIGHT')"
        class="px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors touch-manipulation"
        [class.bg-purple-600]="selectedPeriod === 'NIGHT'"
        [class.text-white]="selectedPeriod === 'NIGHT'"
        [class.bg-gray-800]="selectedPeriod !== 'NIGHT'"
        [class.text-gray-400]="selectedPeriod !== 'NIGHT'"
      >
        🌙 Inventario Noche
        @if (nightSnapshot) {
          <span class="ml-2 text-xs opacity-75">{{ nightSnapshot.takenAt | date:'HH:mm' }}</span>
        }
      </button>
    </div>

    <!-- Period note for morning -->
    @if (selectedPeriod === 'MORNING') {
      <p class="text-gray-500 text-xs">
        El inventario de la mañana puede guardarse varias veces — si el gerente trae nuevos suministros, actualiza las cantidades y vuelve a guardar.
      </p>
    }

    <!-- Form grid -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">

      <!-- Flavors -->
      <div class="bg-gray-900 rounded-2xl p-5 space-y-3">
        <h2 class="text-white font-semibold text-sm uppercase tracking-wide text-gray-400">Sabores</h2>
        @for (row of flavorQties; track row.id) {
          <div class="flex items-center gap-3">
            <label class="flex-1 text-white text-sm truncate">{{ row.label }}</label>
            <div class="flex items-center gap-2">
              <button (click)="row.qty = Math.max(0, row.qty - 0.5)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-bold touch-manipulation">−</button>
              <input
                [(ngModel)]="row.qty"
                type="number"
                min="0"
                step="0.5"
                class="w-20 bg-gray-800 text-white text-center rounded-lg px-2 py-1.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              />
              <button (click)="row.qty = row.qty + 0.5" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-bold touch-manipulation">+</button>
            </div>
          </div>
        }
      </div>

      <!-- Toppings -->
      <div class="bg-gray-900 rounded-2xl p-5 space-y-3">
        <h2 class="text-white font-semibold text-sm uppercase tracking-wide text-gray-400">Toppings</h2>
        @for (row of toppingQties; track row.id) {
          <div class="flex items-center gap-3">
            <label class="flex-1 text-white text-sm truncate">{{ row.label }}</label>
            <div class="flex items-center gap-2">
              <button (click)="row.qty = Math.max(0, row.qty - 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-bold touch-manipulation">−</button>
              <input
                [(ngModel)]="row.qty"
                type="number"
                min="0"
                step="1"
                class="w-20 bg-gray-800 text-white text-center rounded-lg px-2 py-1.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              />
              <button (click)="row.qty = row.qty + 1" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-bold touch-manipulation">+</button>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Notes + save -->
    <div class="space-y-3">
      <textarea
        [(ngModel)]="notes"
        rows="2"
        placeholder="Notas (opcional)"
        class="w-full bg-gray-900 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-sm"
      ></textarea>

      <div class="flex items-center gap-4">
        <button
          (click)="save()"
          [disabled]="saving"
          class="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-semibold touch-manipulation"
        >
          {{ saving ? 'Guardando...' : (selectedPeriod === 'MORNING' ? '💾 Guardar inventario mañana' : '💾 Guardar inventario noche') }}
        </button>
        @if (saveSuccess) {
          <span class="text-green-400 text-sm">✓ Guardado correctamente</span>
        }
        @if (saveError) {
          <span class="text-red-400 text-sm">{{ saveError }}</span>
        }
      </div>
    </div>

    <!-- Delta table (only if both snapshots exist) -->
    @if (delta.length > 0) {
      <div class="bg-gray-900 rounded-2xl p-5 space-y-3">
        <h2 class="text-white font-semibold">Consumo del día</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-gray-400 text-left border-b border-gray-800">
                <th class="pb-2 font-medium">Ítem</th>
                <th class="pb-2 font-medium text-right">Mañana</th>
                <th class="pb-2 font-medium text-right">Noche</th>
                <th class="pb-2 font-medium text-right">Consumido</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-800">
              @for (line of delta; track line.label) {
                <tr
                  [class.text-white]="line.consumed >= 0"
                  [class.text-amber-400]="line.consumed < 0"
                >
                  <td class="py-2">{{ line.label }}</td>
                  <td class="py-2 text-right text-gray-300">{{ formatQty(line.morning) }}</td>
                  <td class="py-2 text-right text-gray-300">{{ formatQty(line.night) }}</td>
                  <td class="py-2 text-right font-semibold">
                    {{ line.consumed < 0 ? '+' + formatQty(-line.consumed) + ' (reabastecido)' : formatQty(line.consumed) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else if (morningSnapshot && !nightSnapshot) {
      <p class="text-gray-500 text-sm">Guarda el inventario de noche para ver el consumo del día.</p>
    }

  }
</div>
```

**Note:** The template references `Math.max` — Angular templates don't have access to global `Math`. Fix by adding a `mathMax` helper or replace with component methods. Replace button click expressions with method calls:

In the component, add:
```typescript
inc(row: QtyRow, step: number)  { row.qty = Math.round((row.qty + step) * 10) / 10; }
dec(row: QtyRow, step: number)  { row.qty = Math.max(0, Math.round((row.qty - step) * 10) / 10); }
```

And replace in template:
```html
<!-- −  button -->
<button (click)="dec(row, 0.5)" ...>−</button>
<!-- +  button -->
<button (click)="inc(row, 0.5)" ...>+</button>
```
Use step 0.5 for flavors and step 1 for toppings.

- [ ] **Step 3: Build to verify (fix any TypeScript errors)**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -12
```

Fix any errors before committing.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/features/inventory/
git commit -m "feat: replace Inventory stub with morning/night snapshot form + delta table"
```

---

## Task 6: Angular Dashboard page

**Files:**
- Modify: `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts` (replaces stub)
- Create:  `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html`

**Context:** ADMIN-only route. Date range filter defaults to last 7 days. No charting library — use Tailwind CSS bars (width set as inline style percentage). `forkJoin` loads summary and top-items in parallel.

- [ ] **Step 1: Replace stub component**

Replace `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts`:
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { SummaryData, TopItemsData } from '../../../core/models/analytics.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private analyticsSvc = inject(AnalyticsService);

  fromDate = '';
  toDate   = '';

  summary: SummaryData | null = null;
  topItems: TopItemsData | null = null;

  loading = false;
  error   = '';

  ngOnInit() {
    const today   = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 6);
    this.fromDate = weekAgo.toISOString().split('T')[0];
    this.toDate   = today.toISOString().split('T')[0];
    this.load();
  }

  load() {
    this.loading = true;
    this.error   = '';
    forkJoin({
      summary:  this.analyticsSvc.getSummary(this.fromDate, this.toDate),
      topItems: this.analyticsSvc.getTopItems(this.fromDate, this.toDate),
    }).subscribe({
      next: ({ summary, topItems }) => {
        this.summary  = summary;
        this.topItems = topItems;
        this.loading  = false;
      },
      error: () => {
        this.error   = 'Error al cargar datos';
        this.loading = false;
      },
    });
  }

  setLastDays(days: number) {
    const today   = new Date();
    const from    = new Date();
    from.setDate(today.getDate() - (days - 1));
    this.fromDate = from.toISOString().split('T')[0];
    this.toDate   = today.toISOString().split('T')[0];
    this.load();
  }

  maxFlavorCount(): number {
    return this.topItems?.topFlavors?.[0]?.count ?? 1;
  }

  maxToppingQty(): number {
    return this.topItems?.topToppings?.[0]?.quantity ?? 1;
  }

  formatPrice(n: number) { return `$${Number(n).toFixed(2)}`; }
}
```

- [ ] **Step 2: Create template**

Create `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html`:
```html
<div class="min-h-screen bg-gray-950 p-5 space-y-6">

  <!-- Header + filters -->
  <div class="flex flex-wrap items-center gap-3">
    <h1 class="text-2xl font-bold text-white">Dashboard</h1>
    <div class="ml-auto flex items-center gap-2 flex-wrap">
      <button (click)="setLastDays(7)"  class="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg touch-manipulation">7 días</button>
      <button (click)="setLastDays(14)" class="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg touch-manipulation">14 días</button>
      <button (click)="setLastDays(30)" class="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg touch-manipulation">30 días</button>
      <input [(ngModel)]="fromDate" type="date" class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
      <span class="text-gray-400 text-sm">—</span>
      <input [(ngModel)]="toDate" type="date" class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
      <button (click)="load()" class="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg font-medium touch-manipulation">Buscar</button>
    </div>
  </div>

  @if (loading) {
    <p class="text-gray-400">Cargando...</p>
  } @else if (error) {
    <p class="text-red-400">{{ error }}</p>
  } @else if (summary) {

    <!-- KPI cards -->
    <div class="grid grid-cols-3 gap-4">
      <div class="bg-gray-900 rounded-2xl p-5">
        <p class="text-gray-400 text-sm">Ingresos totales</p>
        <p class="text-3xl font-bold text-white mt-1">{{ formatPrice(summary.totalRevenue) }}</p>
      </div>
      <div class="bg-gray-900 rounded-2xl p-5">
        <p class="text-gray-400 text-sm">Pedidos</p>
        <p class="text-3xl font-bold text-white mt-1">{{ summary.totalOrders }}</p>
      </div>
      <div class="bg-gray-900 rounded-2xl p-5">
        <p class="text-gray-400 text-sm">Con cupón</p>
        <p class="text-3xl font-bold text-white mt-1">{{ summary.ordersWithCoupon }}</p>
        @if (summary.totalOrders > 0) {
          <p class="text-gray-500 text-xs mt-1">
            {{ ((summary.ordersWithCoupon / summary.totalOrders) * 100).toFixed(0) }}% de los pedidos
          </p>
        }
      </div>
    </div>

    <!-- Daily revenue table -->
    @if (summary.dailyRevenue.length > 0) {
      <div class="bg-gray-900 rounded-2xl p-5">
        <h2 class="text-white font-semibold mb-4">Ingresos por día</h2>
        <div class="space-y-2">
          @for (day of summary.dailyRevenue; track day.date) {
            <div class="flex items-center gap-4">
              <span class="text-gray-400 text-sm w-24 shrink-0">{{ day.date | date:'dd/MM' }}</span>
              <div class="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
                <div
                  class="h-full bg-purple-600 rounded-full"
                  [style.width.%]="(day.total / summary.totalRevenue) * 100"
                ></div>
              </div>
              <span class="text-white text-sm font-medium w-20 text-right shrink-0">{{ formatPrice(day.total) }}</span>
              <span class="text-gray-500 text-xs w-16 text-right shrink-0">{{ day.count }} pedido{{ day.count !== 1 ? 's' : '' }}</span>
            </div>
          }
        </div>
      </div>
    } @else {
      <div class="bg-gray-900 rounded-2xl p-5 text-center">
        <p class="text-gray-500">No hay pedidos en este período.</p>
      </div>
    }

    <!-- Top items (flavors + toppings) side by side -->
    @if (topItems) {
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">

        <!-- Top flavors -->
        <div class="bg-gray-900 rounded-2xl p-5">
          <h2 class="text-white font-semibold mb-4">🍨 Sabores más pedidos</h2>
          @if (topItems.topFlavors.length === 0) {
            <p class="text-gray-500 text-sm">Sin datos</p>
          } @else {
            <div class="space-y-3">
              @for (item of topItems.topFlavors; track item.name) {
                <div class="space-y-1">
                  <div class="flex justify-between text-sm">
                    <span class="text-white">{{ item.name }}</span>
                    <span class="text-gray-400">{{ item.count }} pedido{{ item.count !== 1 ? 's' : '' }}</span>
                  </div>
                  <div class="bg-gray-800 rounded-full h-2">
                    <div
                      class="h-full bg-purple-500 rounded-full"
                      [style.width.%]="(item.count / maxFlavorCount()) * 100"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Top toppings -->
        <div class="bg-gray-900 rounded-2xl p-5">
          <h2 class="text-white font-semibold mb-4">🍬 Toppings más pedidos</h2>
          @if (topItems.topToppings.length === 0) {
            <p class="text-gray-500 text-sm">Sin datos</p>
          } @else {
            <div class="space-y-3">
              @for (item of topItems.topToppings; track item.name) {
                <div class="space-y-1">
                  <div class="flex justify-between text-sm">
                    <span class="text-white">{{ item.name }}</span>
                    <span class="text-gray-400">{{ item.quantity }} unidades</span>
                  </div>
                  <div class="bg-gray-800 rounded-full h-2">
                    <div
                      class="h-full bg-purple-500 rounded-full"
                      [style.width.%]="(item.quantity / maxToppingQty()) * 100"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

      </div>
    }

  }
</div>
```

- [ ] **Step 3: Build to verify**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -10
```

Expected: build succeeds. Fix any TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/features/analytics/dashboard/
git commit -m "feat: replace Dashboard stub with analytics — revenue, orders, top flavors/toppings"
```

---

## Plan 4 Complete

The app now supports:
- **POST /inventory/snapshots** — upserts a snapshot for a period+date (safe to call multiple times — manager can update morning inventory after restocking)
- **GET /inventory/snapshots?date=** — returns `{ morning, night }` for a given date
- **GET /analytics/summary?from=&to=** — daily revenue breakdown with totals
- **GET /analytics/top-items?from=&to=** — top 5 flavors and toppings by order volume
- **Angular Inventory** (`/inventory`) — MORNING/NIGHT tabs, date picker, flavor+topping qty form, automatic delta table when both snapshots exist, re-saveable morning snapshot
- **Angular Dashboard** (`/dashboard`) — 7/14/30-day shortcuts, KPI cards, daily revenue bar chart (CSS), top-flavors and top-toppings bar charts (CSS), no external chart library

**Next:** No Plan 5 defined yet. The full app (foundation → catalog → orders → inventory → analytics) is now feature-complete.
