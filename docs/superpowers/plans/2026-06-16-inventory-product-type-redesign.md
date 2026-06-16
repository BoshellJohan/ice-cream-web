# Inventory & Product Types Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CUP/BOWL/DRINK product types with CONE/CONTAINER/BEVERAGE, expand sizes with oz values, decouple packaging inventory from individual products, and add a sold-count overlay for beverage lines.

**Architecture:** Prisma enum changes require a custom migration (PostgreSQL can't drop enum values — we rename old type, create new, swap column, drop old). All non-user data is wiped in the migration. The backend service computes a beverage overlay (soldSince/remaining) on every snapshot read via an `orderItem.groupBy` query. The frontend inventory component restructures into three row groups (cones/containers/beverages).

**Tech Stack:** NestJS 11, Prisma 5, PostgreSQL, Angular 18, Tailwind CSS. Tests: Jest (backend), Angular build check (frontend).

---

## File Map

**Backend — create or modify:**
- `helados-api/prisma/schema.prisma` — enum changes, nullable size, InventoryLine columns
- `helados-api/prisma/migrations/<new>/migration.sql` — custom SQL (wipe + enum swap)
- `helados-api/src/products/dto/create-product.dto.ts` — new type enum, optional size, BEVERAGE validation
- `helados-api/src/products/dto/update-product.dto.ts` — same
- `helados-api/src/products/products.service.ts` — BEVERAGE forces directSale=true, cross-field size validation
- `helados-api/src/products/products.service.spec.ts` — new tests
- `helados-api/src/inventory/dto/create-snapshot.dto.ts` — add productType/productSize to InventoryLineDto
- `helados-api/src/inventory/inventory.service.ts` — pass new fields on create/update, add beverage overlay
- `helados-api/src/inventory/inventory.service.spec.ts` — update fixtures, add overlay test

**Frontend — modify:**
- `helados-ui/src/app/core/models/product.model.ts` — new types
- `helados-ui/src/app/core/models/inventory.model.ts` — new InventoryLine fields
- `helados-ui/src/app/features/catalog/catalog.component.ts` — productTypes, availableSizes getter
- `helados-ui/src/app/features/catalog/catalog.component.html` — conditional size picker, BEVERAGE hides fields
- `helados-ui/src/app/features/inventory/inventory.component.ts` — 3-section rows, beverage overlay
- `helados-ui/src/app/features/inventory/inventory.component.html` — 3 grouped sections

---

## Task 1: Prisma schema changes + migration

**Files:**
- Modify: `helados-api/prisma/schema.prisma`
- Create: `helados-api/prisma/migrations/<timestamp>_inventory_product_type_redesign/migration.sql`

- [ ] **Step 1: Update schema.prisma**

Replace the `ProductType` enum, expand `ProductSize`, make `Product.size` nullable, add columns to `InventoryLine`:

```prisma
enum ProductType {
  CONE
  CONTAINER
  BEVERAGE
}

enum ProductSize {
  SMALL
  MEDIUM
  LARGE
  OZ4
  OZ5
  OZ6
  OZ7
  OZ8
}

model Product {
  id                  String          @id @default(uuid())
  name                String
  type                ProductType
  size                ProductSize?
  basePrice           Decimal         @db.Decimal(10, 2)
  imageUrl            String?
  active              Boolean         @default(true)
  directSale          Boolean         @default(false)
  includedToppingType ToppingType?
  includedToppingQty  Int?
  createdAt           DateTime        @default(now())
  orderItems          OrderItem[]
  inventoryLines      InventoryLine[]
}

model InventoryLine {
  id          String            @id @default(uuid())
  snapshotId  String
  snapshot    InventorySnapshot @relation(fields: [snapshotId], references: [id])
  productType ProductType?
  productSize ProductSize?
  productId   String?
  product     Product?          @relation(fields: [productId], references: [id])
  label       String?
  quantity    Decimal           @db.Decimal(10, 2)
}
```

- [ ] **Step 2: Create migration with --create-only**

```bash
cd helados-api && npx prisma migrate dev --name inventory_product_type_redesign --create-only
```

Note the generated timestamp folder name (e.g., `20260616120000_inventory_product_type_redesign`).

- [ ] **Step 3: Replace the generated migration SQL**

Open `helados-api/prisma/migrations/<timestamp>_inventory_product_type_redesign/migration.sql` and replace its entire contents with:

```sql
-- Wipe all non-user data (dependency order: leaves first)
DELETE FROM "OrderItemTopping";
DELETE FROM "OrderItem";
DELETE FROM "OrderPayment";
DELETE FROM "Order";
DELETE FROM "InventoryEdit";
DELETE FROM "InventoryLine";
DELETE FROM "InventorySnapshot";
DELETE FROM "Topping";
DELETE FROM "Flavor";
DELETE FROM "Product";

-- Swap ProductType enum (PostgreSQL cannot drop enum values — must recreate)
ALTER TYPE "ProductType" RENAME TO "ProductType_old";
CREATE TYPE "ProductType" AS ENUM ('CONE', 'CONTAINER', 'BEVERAGE');
ALTER TABLE "Product" ALTER COLUMN "type" TYPE "ProductType" USING "type"::text::"ProductType";
DROP TYPE "ProductType_old";

-- Add new ProductSize values (adding is safe without data wipe)
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ4';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ5';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ6';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ7';
ALTER TYPE "ProductSize" ADD VALUE IF NOT EXISTS 'OZ8';

-- Make Product.size nullable
ALTER TABLE "Product" ALTER COLUMN "size" DROP NOT NULL;

-- Add productType and productSize to InventoryLine
ALTER TABLE "InventoryLine" ADD COLUMN "productType" "ProductType";
ALTER TABLE "InventoryLine" ADD COLUMN "productSize" "ProductSize";
```

- [ ] **Step 4: Apply the migration**

```bash
cd helados-api && npx prisma migrate dev
```

Expected: `The following migration(s) have been applied: …inventory_product_type_redesign`

- [ ] **Step 5: Regenerate Prisma client**

```bash
cd helados-api && npx prisma generate
```

Expected: `Generated Prisma Client`

- [ ] **Step 6: Verify the DB schema**

```bash
PGPASSWORD=helados /Library/PostgreSQL/17/bin/psql -U helados -d helados_dev -c "\dT+"
```

Expected: `ProductType` shows `CONE | CONTAINER | BEVERAGE`. `ProductSize` shows the 8 values.

- [ ] **Step 7: Commit**

```bash
cd helados-api && git add prisma/schema.prisma prisma/migrations/ && git commit -m "feat: migrate product types to CONE/CONTAINER/BEVERAGE with oz sizes"
```

---

## Task 2: Backend — Product DTOs (new type enum + cross-field size validation)

**Files:**
- Modify: `helados-api/src/products/dto/create-product.dto.ts`
- Modify: `helados-api/src/products/dto/update-product.dto.ts`

- [ ] **Step 1: Update create-product.dto.ts**

```typescript
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsEnum(['CONE', 'CONTAINER', 'BEVERAGE'])
  type: 'CONE' | 'CONTAINER' | 'BEVERAGE';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE', 'OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE' | 'OZ4' | 'OZ5' | 'OZ6' | 'OZ7' | 'OZ8';

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  directSale?: boolean;

  @ValidateIf(o => o.includedToppingQty != null)
  @IsDefined()
  @IsEnum(['NORMAL', 'PREMIUM'])
  includedToppingType?: 'NORMAL' | 'PREMIUM' | null;

  @ValidateIf(o => o.includedToppingType != null)
  @IsDefined()
  @IsInt()
  @Min(1)
  includedToppingQty?: number | null;
}
```

- [ ] **Step 2: Update update-product.dto.ts**

```typescript
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'BEVERAGE'])
  type?: 'CONE' | 'CONTAINER' | 'BEVERAGE';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE', 'OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE' | 'OZ4' | 'OZ5' | 'OZ6' | 'OZ7' | 'OZ8';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  directSale?: boolean;

  @ValidateIf(o => o.includedToppingQty != null)
  @IsDefined()
  @IsEnum(['NORMAL', 'PREMIUM'])
  includedToppingType?: 'NORMAL' | 'PREMIUM' | null;

  @ValidateIf(o => o.includedToppingType != null)
  @IsDefined()
  @IsInt()
  @Min(1)
  includedToppingQty?: number | null;
}
```

- [ ] **Step 3: Commit**

```bash
cd helados-api && git add src/products/dto/ && git commit -m "feat: update product DTOs for BEVERAGE type and oz sizes"
```

---

## Task 3: Backend — Products service (BEVERAGE forces directSale, cross-field size guard)

**Files:**
- Modify: `helados-api/src/products/products.service.ts`
- Modify: `helados-api/src/products/products.service.spec.ts`

- [ ] **Step 1: Write failing tests first**

Add these tests to `helados-api/src/products/products.service.spec.ts` inside `describe('ProductsService')`:

```typescript
it('create BEVERAGE product forces directSale=true', async () => {
  const dto = {
    name: 'Agua Cristal', type: 'BEVERAGE' as const, basePrice: 1.5,
  };
  mockPrisma.product.create.mockResolvedValue({
    id: 'bev1', ...dto, size: null, directSale: true, active: true,
    imageUrl: null, includedToppingType: null, includedToppingQty: null, createdAt: new Date(),
  });
  await service.create(dto);
  const callArgs = mockPrisma.product.create.mock.calls[0][0];
  expect(callArgs.data.directSale).toBe(true);
});

it('create CONE with invalid size throws BadRequestException', async () => {
  const dto = { name: 'Cono', type: 'CONE' as const, size: 'OZ4' as any, basePrice: 3 };
  await expect(service.create(dto)).rejects.toThrow(BadRequestException);
});

it('create CONTAINER with invalid size throws BadRequestException', async () => {
  const dto = { name: 'Envase', type: 'CONTAINER' as const, size: 'SMALL' as any, basePrice: 5 };
  await expect(service.create(dto)).rejects.toThrow(BadRequestException);
});

it('create BEVERAGE with size throws BadRequestException', async () => {
  const dto = { name: 'Agua', type: 'BEVERAGE' as const, size: 'SMALL' as any, basePrice: 1.5 };
  await expect(service.create(dto)).rejects.toThrow(BadRequestException);
});
```

Also add `BadRequestException` to the import:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd helados-api && npm test -- --testPathPattern=products.service
```

Expected: 4 new tests FAIL (BadRequestException not yet thrown, directSale not yet forced).

- [ ] **Step 3: Update products.service.ts**

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const CONE_SIZES      = ['SMALL', 'MEDIUM', 'LARGE'];
const CONTAINER_SIZES = ['OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'];

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateProductDto) {
    this.validateTypeSize(dto.type, dto.size);
    const data = dto.type === 'BEVERAGE'
      ? { ...dto, directSale: true }
      : dto;
    return this.prisma.product.create({ data });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    const effectiveType = dto.type ?? product.type;
    const effectiveSize = dto.size ?? (product.size ?? undefined);
    this.validateTypeSize(effectiveType as string, effectiveSize);
    const data = effectiveType === 'BEVERAGE'
      ? { ...dto, directSale: true }
      : dto;
    return this.prisma.product.update({ where: { id }, data });
  }

  async toggleActive(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return this.prisma.product.update({ where: { id }, data: { active: !product.active } });
  }

  private validateTypeSize(type: string, size?: string) {
    if (type === 'BEVERAGE') {
      if (size) throw new BadRequestException('Los productos BEVERAGE no tienen tamaño');
      return;
    }
    if (type === 'CONE') {
      if (!size || !CONE_SIZES.includes(size)) {
        throw new BadRequestException('Los conos requieren tamaño SMALL, MEDIUM o LARGE');
      }
      return;
    }
    if (type === 'CONTAINER') {
      if (!size || !CONTAINER_SIZES.includes(size)) {
        throw new BadRequestException('Los envases requieren tamaño OZ4, OZ5, OZ6, OZ7 u OZ8');
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd helados-api && npm test -- --testPathPattern=products.service
```

Expected: all tests PASS (check total count — should be 9 tests now).

- [ ] **Step 5: Commit**

```bash
cd helados-api && git add src/products/ && git commit -m "feat: BEVERAGE products force directSale=true, validate type/size combos"
```

---

## Task 4: Backend — Inventory DTO + service (new line fields + beverage overlay)

**Files:**
- Modify: `helados-api/src/inventory/dto/create-snapshot.dto.ts`
- Modify: `helados-api/src/inventory/inventory.service.ts`
- Modify: `helados-api/src/inventory/inventory.service.spec.ts`

- [ ] **Step 1: Update create-snapshot.dto.ts**

```typescript
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum SnapshotPeriod {
  MORNING = 'MORNING',
  NIGHT = 'NIGHT',
}

export class InventoryLineDto {
  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'BEVERAGE'])
  productType?: 'CONE' | 'CONTAINER' | 'BEVERAGE';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE', 'OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'])
  productSize?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  label?: string;

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

- [ ] **Step 2: Write failing tests in inventory.service.spec.ts**

Replace the full file with:

```typescript
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
```

- [ ] **Step 3: Run failing tests**

```bash
cd helados-api && npm test -- --testPathPattern=inventory.service
```

Expected: Several new tests FAIL (overlay method not yet implemented).

- [ ] **Step 4: Update inventory.service.ts**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
import { UpdateSnapshotDto } from './dto/update-snapshot.dto';

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
        order: { createdAt: { gte: snapshot.takenAt } },
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
```

- [ ] **Step 5: Run all tests**

```bash
cd helados-api && npm test
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd helados-api && git add src/inventory/ && git commit -m "feat: inventory service supports type/size lines and beverage sold-count overlay"
```

---

## Task 5: Frontend — Angular models

**Files:**
- Modify: `helados-ui/src/app/core/models/product.model.ts`
- Modify: `helados-ui/src/app/core/models/inventory.model.ts`

- [ ] **Step 1: Update product.model.ts**

```typescript
import { ToppingType } from './topping.model';

export type ProductType = 'CONE' | 'CONTAINER' | 'BEVERAGE';
export type ProductSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'OZ4' | 'OZ5' | 'OZ6' | 'OZ7' | 'OZ8';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  size: ProductSize | null;
  basePrice: number;
  imageUrl?: string;
  active: boolean;
  directSale: boolean;
  includedToppingType?: ToppingType | null;
  includedToppingQty?: number | null;
  createdAt: string;
}

export interface CreateProductPayload {
  name: string;
  type: ProductType;
  size?: ProductSize;
  basePrice: number;
  imageUrl?: string;
  directSale?: boolean;
  includedToppingType?: ToppingType | null;
  includedToppingQty?: number | null;
}
```

- [ ] **Step 2: Update inventory.model.ts**

```typescript
export type SnapshotPeriod = 'MORNING' | 'NIGHT';

export interface InventoryLine {
  id: string;
  productType: string | null;
  productSize: string | null;
  productId: string | null;
  product: { id: string; name: string; type: string } | null;
  label: string | null;
  quantity: number;
  soldSince?: number;
  remaining?: number;
}

export interface InventoryEdit {
  id: string;
  editedBy: string;
  user: { id: string; name: string };
  editedAt: string;
  reason: string | null;
}

export interface InventorySnapshot {
  id: string;
  takenBy: string;
  user: { id: string; name: string };
  takenAt: string;
  period: SnapshotPeriod;
  notes: string | null;
  lines: InventoryLine[];
  edits: InventoryEdit[];
}

export interface InventorySnapshotSummary {
  id: string;
  takenBy: string;
  user: { id: string; name: string };
  takenAt: string;
  period: SnapshotPeriod;
  notes: string | null;
  lines: { id: string }[];
  edits: { id: string }[];
}

export interface SnapshotPair {
  morning: InventorySnapshot | null;
  night:   InventorySnapshot | null;
}

export interface InventoryLinePayload {
  productType?: string;
  productSize?: string;
  productId?: string;
  label?: string;
  quantity: number;
}

export interface CreateSnapshotPayload {
  period: SnapshotPeriod;
  date: string;
  lines: InventoryLinePayload[];
  notes?: string;
}

export interface UpdateSnapshotPayload {
  lines: InventoryLinePayload[];
  notes?: string;
  reason?: string;
}
```

- [ ] **Step 3: Angular build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds (may have type errors in catalog/inventory components — those are fixed in Tasks 6 & 7).

- [ ] **Step 4: Commit**

```bash
cd helados-ui && git add src/app/core/models/ && git commit -m "feat: update Angular models for new product types and inventory line fields"
```

---

## Task 6: Frontend — Catalog component (conditional size picker, BEVERAGE handling)

**Files:**
- Modify: `helados-ui/src/app/features/catalog/catalog.component.ts`
- Modify: `helados-ui/src/app/features/catalog/catalog.component.html`

- [ ] **Step 1: Update catalog.component.ts**

Replace the full file:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { FlavorService } from '../../core/services/flavor.service';
import { ToppingService } from '../../core/services/topping.service';
import { ImageUploadComponent } from '../../shared/components/image-upload/image-upload.component';
import { Product, ProductType, ProductSize } from '../../core/models/product.model';
import { Flavor } from '../../core/models/flavor.model';
import { Topping, ToppingType, ToppingTypeConfig } from '../../core/models/topping.model';

type Tab = 'products' | 'flavors' | 'toppings';
type CatalogItem = (Product | Flavor | Topping) & { basePrice?: number; priceModifier?: number; unitPrice?: number };

export const TYPE_LABELS: Record<string, string> = {
  CONE: 'Cono', CONTAINER: 'Envase', BEVERAGE: 'Bebida',
};
export const SIZE_LABELS: Record<string, string> = {
  SMALL: 'Pequeño', MEDIUM: 'Mediano', LARGE: 'Grande',
  OZ4: '4 oz', OZ5: '5 oz', OZ6: '6 oz', OZ7: '7 oz', OZ8: '8 oz',
};

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageUploadComponent],
  templateUrl: './catalog.component.html',
})
export class CatalogComponent implements OnInit {
  private productSvc = inject(ProductService);
  private flavorSvc  = inject(FlavorService);
  private toppingSvc = inject(ToppingService);

  activeTab: Tab = 'products';
  products: Product[] = [];
  flavors: Flavor[] = [];
  toppings: Topping[] = [];
  typeConfigs: ToppingTypeConfig[] = [];
  loading = false;
  saving  = false;
  error   = '';

  showForm  = false;
  editingId: string | null = null;

  form = {
    name: '',
    basePrice: 0,
    priceModifier: 0,
    toppingType: 'NORMAL' as ToppingType,
    useCustomPrice: false,
    customPrice: 0,
    type: 'CONE' as ProductType,
    size: 'SMALL' as ProductSize | null,
    imageUrl: '',
    directSale: false,
    includedToppingType: null as ToppingType | null,
    includedToppingQty: null as number | null,
  };

  editingTypeConfig: ToppingType | null = null;
  typeConfigDraft = 0;

  productTypes: ProductType[] = ['CONE', 'CONTAINER', 'BEVERAGE'];
  toppingTypes: ToppingType[] = ['NORMAL', 'PREMIUM'];

  readonly tabs = [
    { key: 'products' as Tab, label: 'Productos' },
    { key: 'flavors'  as Tab, label: 'Sabores' },
    { key: 'toppings' as Tab, label: 'Toppings' },
  ];

  get availableSizes(): ProductSize[] {
    if (this.form.type === 'CONE')      return ['SMALL', 'MEDIUM', 'LARGE'];
    if (this.form.type === 'CONTAINER') return ['OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'];
    return [];
  }

  onTypeChange() {
    const sizes = this.availableSizes;
    this.form.size = sizes.length > 0 ? sizes[0] : null;
    if (this.form.type === 'BEVERAGE') {
      this.form.directSale = true;
      this.form.includedToppingType = null;
      this.form.includedToppingQty  = null;
    }
  }

  productSubtitle(item: Product): string {
    const typePart = TYPE_LABELS[item.type] ?? item.type;
    if (!item.size) return typePart;
    return `${typePart} · ${SIZE_LABELS[item.size] ?? item.size}`;
  }

  ngOnInit() { this.loadAll(); }

  loadAll() {
    this.loading = true;
    this.productSvc.getAll().subscribe({ next: p => this.products = p, error: () => {} });
    this.flavorSvc.getAll().subscribe({ next: f => this.flavors = f, error: () => {} });
    this.toppingSvc.getAll().subscribe({ next: t => { this.toppings = t; this.loading = false; }, error: () => { this.loading = false; } });
    this.toppingSvc.getTypeConfigs().subscribe({ next: c => this.typeConfigs = c, error: () => {} });
  }

  get currentItems(): CatalogItem[] {
    if (this.activeTab === 'products') return this.products;
    if (this.activeTab === 'flavors')  return this.flavors;
    return this.toppings;
  }

  priceLabel(item: CatalogItem): string {
    const price = item.basePrice ?? item.priceModifier ?? item.unitPrice ?? 0;
    return `$${Number(price).toFixed(2)}`;
  }

  typeConfigPrice(type: ToppingType): number {
    return Number(this.typeConfigs.find(c => c.type === type)?.unitPrice ?? 0);
  }

  startEditTypeConfig(type: ToppingType) {
    this.editingTypeConfig = type;
    this.typeConfigDraft = this.typeConfigPrice(type);
  }

  saveTypeConfig() {
    if (!this.editingTypeConfig) return;
    const type = this.editingTypeConfig;
    this.toppingSvc.updateTypeConfig(type, this.typeConfigDraft).subscribe({
      next: (updated) => {
        const idx = this.typeConfigs.findIndex(c => c.type === type);
        if (idx >= 0) this.typeConfigs[idx] = updated;
        this.editingTypeConfig = null;
        this.loadAll();
      },
      error: () => {},
    });
  }

  openCreate() {
    this.editingId = null;
    this.form = {
      name: '', basePrice: 0, priceModifier: 0, toppingType: 'NORMAL',
      useCustomPrice: false, customPrice: 0, type: 'CONE', size: 'SMALL',
      imageUrl: '', directSale: false, includedToppingType: null, includedToppingQty: null,
    };
    this.error = '';
    this.showForm = true;
  }

  openEdit(item: CatalogItem) {
    this.editingId = item.id;
    const topping = item as Topping;
    const product = item as Product;
    this.form = {
      name:           item.name,
      basePrice:      Number(product.basePrice ?? 0),
      priceModifier:  Number((item as Flavor).priceModifier ?? 0),
      toppingType:    topping.type ?? 'NORMAL',
      useCustomPrice: topping.customPrice != null,
      customPrice:    Number(topping.customPrice ?? 0),
      type:           product.type ?? 'CONE',
      size:           product.size ?? null,
      imageUrl:       item.imageUrl ?? '',
      directSale:     product.directSale ?? false,
      includedToppingType: product.includedToppingType ?? null,
      includedToppingQty:  product.includedToppingQty ?? null,
    };
    this.error = '';
    this.showForm = true;
  }

  onImageUploaded(url: string) { this.form.imageUrl = url; }

  save() {
    this.saving = true;
    this.error  = '';

    const obs: Observable<unknown> = this.activeTab === 'products'
      ? (this.editingId
          ? this.productSvc.update(this.editingId, {
              name:     this.form.name,
              type:     this.form.type,
              size:     this.form.size ?? undefined,
              basePrice: this.form.basePrice,
              imageUrl: this.form.imageUrl || undefined,
              directSale: this.form.directSale,
              includedToppingType: this.form.includedToppingType,
              includedToppingQty:  this.form.includedToppingType ? this.form.includedToppingQty : null,
            })
          : this.productSvc.create({
              name:     this.form.name,
              type:     this.form.type,
              size:     this.form.size ?? undefined,
              basePrice: this.form.basePrice,
              imageUrl: this.form.imageUrl || undefined,
              directSale: this.form.directSale,
              includedToppingType: this.form.includedToppingType ?? undefined,
              includedToppingQty:  this.form.includedToppingType ? (this.form.includedToppingQty ?? undefined) : undefined,
            }))
      : this.activeTab === 'flavors'
        ? (this.editingId
            ? this.flavorSvc.update(this.editingId, { name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined })
            : this.flavorSvc.create({ name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined }))
        : (this.editingId
            ? this.toppingSvc.update(this.editingId, {
                name:        this.form.name,
                type:        this.form.toppingType,
                customPrice: this.form.useCustomPrice ? this.form.customPrice : null,
                imageUrl:    this.form.imageUrl || undefined,
              })
            : this.toppingSvc.create({
                name:        this.form.name,
                type:        this.form.toppingType,
                customPrice: this.form.useCustomPrice ? this.form.customPrice : null,
                imageUrl:    this.form.imageUrl || undefined,
              }));

    obs.subscribe({
      next:  () => { this.saving = false; this.showForm = false; this.loadAll(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al guardar'; },
    });
  }

  toggleActive(item: CatalogItem) {
    const obs: Observable<unknown> = this.activeTab === 'products'
      ? this.productSvc.toggleActive(item.id)
      : this.activeTab === 'flavors'
        ? this.flavorSvc.toggleActive(item.id)
        : this.toppingSvc.toggleActive(item.id);
    obs.subscribe({ next: () => this.loadAll(), error: () => {} });
  }
}
```

- [ ] **Step 2: Update catalog.component.html**

Replace only the `@if (activeTab === 'products')` form block (inside the form panel, lines 126–185 of the current file). Replace from `@if (activeTab === 'products') {` through the closing `}` of that block with:

```html
        @if (activeTab === 'products') {
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm text-gray-300 mb-1">Tipo</label>
              <select [(ngModel)]="form.type" (ngModelChange)="onTypeChange()" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
                @for (t of productTypes; track t) {
                  <option [value]="t">{{ t === 'CONE' ? 'Cono' : t === 'CONTAINER' ? 'Envase' : 'Bebida' }}</option>
                }
              </select>
            </div>
            @if (availableSizes.length > 0) {
              <div>
                <label class="block text-sm text-gray-300 mb-1">Tamaño</label>
                <select [(ngModel)]="form.size" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
                  @for (s of availableSizes; track s) {
                    <option [value]="s">{{ s === 'SMALL' ? 'Pequeño' : s === 'MEDIUM' ? 'Mediano' : s === 'LARGE' ? 'Grande' : s.toLowerCase().replace('oz', '') + ' oz' }}</option>
                  }
                </select>
              </div>
            }
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Precio base ($)</label>
            <input [(ngModel)]="form.basePrice" type="number" min="0" step="0.01" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>

          @if (form.type !== 'BEVERAGE') {
            <label class="flex items-center gap-3 cursor-pointer select-none">
              <div class="relative">
                <input type="checkbox" [(ngModel)]="form.directSale" class="sr-only" />
                <div class="w-10 h-6 rounded-full transition-colors"
                     [class.bg-purple-600]="form.directSale"
                     [class.bg-gray-700]="!form.directSale">
                  <div class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform"
                       [class.translate-x-4]="form.directSale"></div>
                </div>
              </div>
              <div>
                <p class="text-sm text-white font-medium">Venta directa</p>
                <p class="text-xs text-gray-400">Se agrega al pedido sin seleccionar sabor ni toppings</p>
              </div>
            </label>

            <div>
              <label class="block text-sm text-gray-300 mb-1">Topping incluido</label>
              <select [(ngModel)]="form.includedToppingType" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option [ngValue]="null">Ninguno</option>
                <option value="NORMAL">Normal</option>
                <option value="PREMIUM">Premium</option>
              </select>
            </div>

            @if (form.includedToppingType) {
              <div>
                <label class="block text-sm text-gray-300 mb-1">Cantidad incluida</label>
                <input
                  [(ngModel)]="form.includedToppingQty"
                  type="number" min="1" step="1"
                  class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            }
          } @else {
            <p class="text-xs text-purple-400 bg-purple-500/10 rounded-lg px-3 py-2">
              Las bebidas se venden de forma directa y se rastrean individualmente en inventario.
            </p>
          }
        }
```

Also update the product card subtitle in the card grid (after `<p class="font-bold text-white text-sm truncate">{{ item.name }}</p>`) to add a subtitle line for products. Find this section in the card grid and add a subtitle:

```html
            <p class="font-bold text-white text-sm truncate">{{ item.name }}</p>
            @if (activeTab === 'products') {
              <p class="text-gray-500 text-xs mt-0.5">{{ productSubtitle($any(item)) }}</p>
            }
            <p class="text-purple-400 text-sm mt-0.5">{{ priceLabel(item) }}</p>
```

- [ ] **Step 3: Angular build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
cd helados-ui && git add src/app/features/catalog/ && git commit -m "feat: catalog handles BEVERAGE type with conditional size picker and hidden fields"
```

---

## Task 7: Frontend — Inventory component (3-section rows, beverage overlay)

**Files:**
- Modify: `helados-ui/src/app/features/inventory/inventory.component.ts`
- Modify: `helados-ui/src/app/features/inventory/inventory.component.html`

- [ ] **Step 1: Replace inventory.component.ts**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../../core/services/product.service';
import { InventoryApiService } from '../../core/services/inventory.service';
import { Product } from '../../core/models/product.model';
import {
  InventorySnapshot, InventorySnapshotSummary,
  InventoryLine, InventoryLinePayload, SnapshotPeriod,
} from '../../core/models/inventory.model';

interface PackagingRow {
  productType: 'CONE' | 'CONTAINER';
  productSize: string;
  display: string;
  qty: number;
}

interface BeverageRow {
  productId: string;
  display: string;
  qty: number;
}

const CONE_SIZES      = ['SMALL', 'MEDIUM', 'LARGE'];
const CONTAINER_SIZES = ['OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'];

const SIZE_LABELS: Record<string, string> = {
  SMALL: 'Pequeño', MEDIUM: 'Mediano', LARGE: 'Grande',
  OZ4: '4 oz', OZ5: '5 oz', OZ6: '6 oz', OZ7: '7 oz', OZ8: '8 oz',
};

type PanelMode = 'none' | 'new' | 'view' | 'edit';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  private productSvc   = inject(ProductService);
  private inventorySvc = inject(InventoryApiService);

  history: InventorySnapshotSummary[] = [];
  loadingHistory = true;
  products: Product[] = [];

  panelMode: PanelMode = 'none';
  selectedSnapshot: InventorySnapshot | null = null;
  loadingDetail = false;

  // New/edit form rows (shared between new and edit panels)
  coneRows:      PackagingRow[] = [];
  containerRows: PackagingRow[] = [];
  beverageRows:  BeverageRow[]  = [];

  newDate    = new Date().toISOString().split('T')[0];
  newPeriod: SnapshotPeriod = 'MORNING';
  newNotes   = '';
  saving     = false;
  saveError  = '';

  editNotes  = '';
  editReason = '';
  editing    = false;
  editError  = '';

  ngOnInit() {
    this.productSvc.getAll().subscribe({
      next: (products) => {
        this.products = products.filter(p => p.active);
        this.loadHistory();
      },
    });
  }

  loadHistory() {
    this.loadingHistory = true;
    this.inventorySvc.getAll().subscribe({
      next:  (list) => { this.history = list; this.loadingHistory = false; },
      error: ()     => { this.loadingHistory = false; },
    });
  }

  periodLabel(p: SnapshotPeriod) { return p === 'MORNING' ? 'Mañana' : 'Noche'; }

  openView(row: InventorySnapshotSummary) {
    this.panelMode     = 'view';
    this.loadingDetail = true;
    this.selectedSnapshot = null;
    this.inventorySvc.getOne(row.id).subscribe({
      next:  (s) => { this.selectedSnapshot = s; this.loadingDetail = false; },
      error: ()  => { this.loadingDetail = false; },
    });
  }

  closePanel() {
    this.panelMode = 'none';
    this.selectedSnapshot = null;
    this.saveError = '';
    this.editError = '';
  }

  openNew() {
    this.panelMode = 'new';
    this.newDate   = new Date().toISOString().split('T')[0];
    this.newPeriod = 'MORNING';
    this.newNotes  = '';
    this.saveError = '';
    this.buildRows(null);
  }

  private buildRows(snapshot: InventorySnapshot | null) {
    const lines = snapshot?.lines ?? [];
    const bevProds = this.products.filter(p => p.type === 'BEVERAGE');

    this.coneRows = CONE_SIZES.map(size => ({
      productType: 'CONE' as const,
      productSize: size,
      display: SIZE_LABELS[size] ?? size,
      qty: Number(lines.find(l => l.productType === 'CONE' && l.productSize === size)?.quantity ?? 0),
    }));

    this.containerRows = CONTAINER_SIZES.map(size => ({
      productType: 'CONTAINER' as const,
      productSize: size,
      display: SIZE_LABELS[size] ?? size,
      qty: Number(lines.find(l => l.productType === 'CONTAINER' && l.productSize === size)?.quantity ?? 0),
    }));

    this.beverageRows = bevProds.map(p => ({
      productId: p.id,
      display:   p.name,
      qty: Number(lines.find(l => l.productId === p.id)?.quantity ?? 0),
    }));
  }

  inc(row: PackagingRow | BeverageRow, step: number) {
    row.qty = Math.round((row.qty + step) * 10) / 10;
  }

  dec(row: PackagingRow | BeverageRow, step: number) {
    row.qty = Math.max(0, Math.round((row.qty - step) * 10) / 10);
  }

  private buildLines(): InventoryLinePayload[] {
    return [
      ...this.coneRows.map(r => ({ productType: r.productType, productSize: r.productSize, quantity: r.qty })),
      ...this.containerRows.map(r => ({ productType: r.productType, productSize: r.productSize, quantity: r.qty })),
      ...this.beverageRows.map(r => ({ productId: r.productId, quantity: r.qty })),
    ];
  }

  saveNew() {
    this.saving    = true;
    this.saveError = '';
    this.inventorySvc.upsert({
      period: this.newPeriod,
      date:   this.newDate,
      lines:  this.buildLines(),
      notes:  this.newNotes || undefined,
    }).subscribe({
      next:  () => { this.saving = false; this.closePanel(); this.loadHistory(); },
      error: (e) => { this.saving = false; this.saveError = e?.error?.message ?? 'Error al guardar'; },
    });
  }

  startEdit() {
    if (!this.selectedSnapshot) return;
    this.buildRows(this.selectedSnapshot);
    this.editNotes  = this.selectedSnapshot.notes ?? '';
    this.editReason = '';
    this.editError  = '';
    this.panelMode  = 'edit';
  }

  cancelEdit() { this.panelMode = 'view'; }

  saveEdit() {
    if (!this.selectedSnapshot) return;
    this.editing   = true;
    this.editError = '';
    this.inventorySvc.update(this.selectedSnapshot.id, {
      lines:  this.buildLines(),
      notes:  this.editNotes  || undefined,
      reason: this.editReason || undefined,
    }).subscribe({
      next:  (s) => { this.editing = false; this.selectedSnapshot = s; this.panelMode = 'view'; this.loadHistory(); },
      error: (e) => { this.editing = false; this.editError = e?.error?.message ?? 'Error al guardar'; },
    });
  }

  // Grouped view getters
  get viewConeLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.productType === 'CONE') ?? [];
  }
  get viewContainerLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.productType === 'CONTAINER') ?? [];
  }
  get viewBeverageLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.productId && !l.productType) ?? [];
  }
  get viewLabelLines(): InventoryLine[] {
    return this.selectedSnapshot?.lines.filter(l => l.label) ?? [];
  }

  remainingClass(remaining: number | undefined): string {
    if (remaining === undefined) return '';
    if (remaining === 0)  return 'text-red-400';
    if (remaining <= 3)   return 'text-amber-400';
    return 'text-green-400';
  }

  sizeLabelFor(size: string | null): string {
    return size ? (SIZE_LABELS[size] ?? size) : '—';
  }

  formatQty(n: number | string) { return Number(n).toFixed(1); }
}
```

- [ ] **Step 2: Replace inventory.component.html**

```html
<div class="min-h-screen bg-gray-950 p-5 space-y-5">

  <!-- Header -->
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">Inventario</h1>
    <button (click)="openNew()"
            class="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl font-semibold touch-manipulation">
      + Nueva lectura
    </button>
  </div>

  <!-- History table -->
  @if (loadingHistory) {
    <p class="text-gray-400">Cargando...</p>
  } @else if (history.length === 0) {
    <div class="bg-gray-900 rounded-2xl p-8 text-center">
      <p class="text-gray-400">No hay lecturas de inventario aún.</p>
      <p class="text-gray-500 text-sm mt-1">Pulsa "Nueva lectura" para empezar.</p>
    </div>
  } @else {
    <div class="bg-gray-900 rounded-2xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 text-left border-b border-gray-800">
            <th class="px-5 py-3 font-medium">Fecha</th>
            <th class="px-5 py-3 font-medium">Periodo</th>
            <th class="px-5 py-3 font-medium">Registrado por</th>
            <th class="px-5 py-3 font-medium text-center">Ítems</th>
            <th class="px-5 py-3 font-medium text-center">Estado</th>
            <th class="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-800">
          @for (row of history; track row.id) {
            <tr class="hover:bg-gray-800/50 transition-colors">
              <td class="px-5 py-3 text-white">{{ row.takenAt | date:'dd/MM/yyyy' }}</td>
              <td class="px-5 py-3 text-gray-300">{{ periodLabel(row.period) }}</td>
              <td class="px-5 py-3 text-gray-300">{{ row.user.name }}</td>
              <td class="px-5 py-3 text-center text-gray-400">{{ row.lines.length }}</td>
              <td class="px-5 py-3 text-center">
                @if (row.edits.length > 0) {
                  <span class="bg-amber-500/20 text-amber-400 text-xs font-medium px-2 py-1 rounded-full">
                    Editado ({{ row.edits.length }})
                  </span>
                } @else {
                  <span class="text-gray-600 text-xs">Original</span>
                }
              </td>
              <td class="px-5 py-3 text-right">
                <button (click)="openView(row)"
                        class="text-purple-400 hover:text-purple-300 text-sm font-medium touch-manipulation">
                  Ver →
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  }

</div>

<!-- ── SIDE PANEL ──────────────────────────────────────────────── -->
@if (panelMode !== 'none') {
  <div class="fixed inset-0 bg-black/60 z-40" (click)="closePanel()"></div>
  <div class="fixed right-0 top-0 h-full w-full max-w-lg bg-gray-900 z-50 flex flex-col shadow-2xl">

    <!-- ── NEW SNAPSHOT ───────────────────────────────────────── -->
    @if (panelMode === 'new') {
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <h2 class="text-white font-bold text-lg">Nueva lectura</h2>
        <button (click)="closePanel()" class="text-gray-400 hover:text-white text-2xl leading-none touch-manipulation">✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-6 space-y-5">
        <div class="flex gap-3">
          <div class="flex-1 space-y-1">
            <label class="text-gray-400 text-xs">Fecha</label>
            <input [(ngModel)]="newDate" type="date"
                   class="w-full bg-gray-800 text-white rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" />
          </div>
          <div class="flex-1 space-y-1">
            <label class="text-gray-400 text-xs">Periodo</label>
            <select [(ngModel)]="newPeriod"
                    class="w-full bg-gray-800 text-white rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm">
              <option value="MORNING">Mañana</option>
              <option value="NIGHT">Noche</option>
            </select>
          </div>
        </div>

        <!-- Conos -->
        <div class="space-y-1">
          <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Conos</p>
          @for (row of coneRows; track row.productSize) {
            <div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5">
              <span class="flex-1 text-white text-sm">{{ row.display }}</span>
              <button (click)="dec(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">−</button>
              <input [(ngModel)]="row.qty" type="number" min="0" step="1"
                     class="w-16 bg-gray-700 text-white text-center rounded-lg px-2 py-1 border border-gray-600 focus:outline-none text-sm" />
              <button (click)="inc(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">+</button>
            </div>
          }
        </div>

        <!-- Envases -->
        <div class="space-y-1">
          <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Envases</p>
          @for (row of containerRows; track row.productSize) {
            <div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5">
              <span class="flex-1 text-white text-sm">{{ row.display }}</span>
              <button (click)="dec(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">−</button>
              <input [(ngModel)]="row.qty" type="number" min="0" step="1"
                     class="w-16 bg-gray-700 text-white text-center rounded-lg px-2 py-1 border border-gray-600 focus:outline-none text-sm" />
              <button (click)="inc(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">+</button>
            </div>
          }
        </div>

        <!-- Bebidas -->
        @if (beverageRows.length > 0) {
          <div class="space-y-1">
            <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Bebidas</p>
            @for (row of beverageRows; track row.productId) {
              <div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5">
                <span class="flex-1 text-white text-sm">{{ row.display }}</span>
                <button (click)="dec(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">−</button>
                <input [(ngModel)]="row.qty" type="number" min="0" step="1"
                       class="w-16 bg-gray-700 text-white text-center rounded-lg px-2 py-1 border border-gray-600 focus:outline-none text-sm" />
                <button (click)="inc(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">+</button>
              </div>
            }
          </div>
        }

        <textarea [(ngModel)]="newNotes" rows="2" placeholder="Notas (opcional)"
                  class="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-sm"></textarea>
      </div>

      <div class="px-6 py-4 border-t border-gray-800 shrink-0 space-y-2">
        @if (saveError) { <p class="text-red-400 text-sm">{{ saveError }}</p> }
        <button (click)="saveNew()" [disabled]="saving"
                class="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold touch-manipulation">
          {{ saving ? 'Guardando...' : 'Guardar lectura' }}
        </button>
      </div>
    }

    <!-- ── VIEW SNAPSHOT ──────────────────────────────────────── -->
    @if (panelMode === 'view') {
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h2 class="text-white font-bold text-lg">
            {{ selectedSnapshot ? periodLabel(selectedSnapshot.period) : '' }}
            — {{ selectedSnapshot?.takenAt | date:'dd/MM/yyyy HH:mm' }}
          </h2>
          @if (selectedSnapshot) {
            <p class="text-gray-400 text-xs mt-0.5">Registrado por {{ selectedSnapshot.user.name }}</p>
          }
        </div>
        <button (click)="closePanel()" class="text-gray-400 hover:text-white text-2xl leading-none touch-manipulation">✕</button>
      </div>

      @if (loadingDetail) {
        <div class="flex-1 flex items-center justify-center">
          <p class="text-gray-400">Cargando...</p>
        </div>
      } @else if (selectedSnapshot) {
        <div class="flex-1 overflow-y-auto p-6 space-y-5">

          <!-- Conos -->
          @if (viewConeLines.length > 0) {
            <div class="space-y-1">
              <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Conos</p>
              @for (line of viewConeLines; track line.id) {
                <div class="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2.5">
                  <span class="text-white text-sm">{{ sizeLabelFor(line.productSize) }}</span>
                  <span class="text-purple-400 font-semibold text-sm">{{ formatQty(line.quantity) }}</span>
                </div>
              }
            </div>
          }

          <!-- Envases -->
          @if (viewContainerLines.length > 0) {
            <div class="space-y-1">
              <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Envases</p>
              @for (line of viewContainerLines; track line.id) {
                <div class="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2.5">
                  <span class="text-white text-sm">{{ sizeLabelFor(line.productSize) }}</span>
                  <span class="text-purple-400 font-semibold text-sm">{{ formatQty(line.quantity) }}</span>
                </div>
              }
            </div>
          }

          <!-- Bebidas (with overlay) -->
          @if (viewBeverageLines.length > 0) {
            <div class="space-y-1">
              <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Bebidas</p>
              @for (line of viewBeverageLines; track line.id) {
                <div class="bg-gray-800 rounded-xl px-4 py-2.5">
                  <div class="flex items-center justify-between">
                    <span class="text-white text-sm">{{ line.product?.name ?? '—' }}</span>
                    <span class="text-gray-300 text-sm font-semibold">{{ formatQty(line.quantity) }} inicial</span>
                  </div>
                  @if (line.soldSince !== undefined) {
                    <div class="flex items-center justify-between mt-1 text-xs">
                      <span class="text-gray-500">− {{ line.soldSince }} vendidas</span>
                      <span [class]="remainingClass(line.remaining)" class="font-semibold">
                        = {{ line.remaining }} restantes
                      </span>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <!-- Free-form labels -->
          @if (viewLabelLines.length > 0) {
            <div class="space-y-1">
              <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Otros</p>
              @for (line of viewLabelLines; track line.id) {
                <div class="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2.5">
                  <span class="text-white text-sm">{{ line.label }}</span>
                  <span class="text-purple-400 font-semibold text-sm">{{ formatQty(line.quantity) }}</span>
                </div>
              }
            </div>
          }

          @if (selectedSnapshot.notes) {
            <div class="bg-gray-800 rounded-xl px-4 py-3">
              <p class="text-gray-400 text-xs mb-1">Notas</p>
              <p class="text-gray-200 text-sm">{{ selectedSnapshot.notes }}</p>
            </div>
          }

          @if (selectedSnapshot.edits.length > 0) {
            <div class="space-y-2">
              <h3 class="text-amber-400 text-sm font-semibold flex items-center gap-2">
                <span>⚠</span> Historial de ediciones
              </h3>
              @for (edit of selectedSnapshot.edits; track edit.id) {
                <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm">
                  <div class="flex justify-between text-gray-300">
                    <span class="font-medium">{{ edit.user.name }}</span>
                    <span class="text-gray-500">{{ edit.editedAt | date:'dd/MM/yyyy HH:mm' }}</span>
                  </div>
                  @if (edit.reason) {
                    <p class="text-gray-400 mt-1">{{ edit.reason }}</p>
                  } @else {
                    <p class="text-gray-600 mt-1 italic">Sin motivo indicado</p>
                  }
                </div>
              }
            </div>
          }

        </div>

        <div class="px-6 py-4 border-t border-gray-800 shrink-0">
          <button (click)="startEdit()"
                  class="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl font-semibold touch-manipulation">
            Editar esta lectura
          </button>
        </div>
      }
    }

    <!-- ── EDIT SNAPSHOT ──────────────────────────────────────── -->
    @if (panelMode === 'edit') {
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <h2 class="text-white font-bold text-lg">Editar lectura</h2>
        <button (click)="cancelEdit()" class="text-gray-400 hover:text-white text-2xl leading-none touch-manipulation">✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-6 space-y-5">
        <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-300">
          Estás editando un registro existente. El cambio quedará registrado en el historial de ediciones.
        </div>

        <!-- Conos -->
        <div class="space-y-1">
          <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Conos</p>
          @for (row of coneRows; track row.productSize) {
            <div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5">
              <span class="flex-1 text-white text-sm">{{ row.display }}</span>
              <button (click)="dec(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">−</button>
              <input [(ngModel)]="row.qty" type="number" min="0" step="1"
                     class="w-16 bg-gray-700 text-white text-center rounded-lg px-2 py-1 border border-gray-600 focus:outline-none text-sm" />
              <button (click)="inc(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">+</button>
            </div>
          }
        </div>

        <!-- Envases -->
        <div class="space-y-1">
          <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Envases</p>
          @for (row of containerRows; track row.productSize) {
            <div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5">
              <span class="flex-1 text-white text-sm">{{ row.display }}</span>
              <button (click)="dec(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">−</button>
              <input [(ngModel)]="row.qty" type="number" min="0" step="1"
                     class="w-16 bg-gray-700 text-white text-center rounded-lg px-2 py-1 border border-gray-600 focus:outline-none text-sm" />
              <button (click)="inc(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">+</button>
            </div>
          }
        </div>

        <!-- Bebidas -->
        @if (beverageRows.length > 0) {
          <div class="space-y-1">
            <p class="text-gray-400 text-xs font-semibold uppercase tracking-wide">Bebidas</p>
            @for (row of beverageRows; track row.productId) {
              <div class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5">
                <span class="flex-1 text-white text-sm">{{ row.display }}</span>
                <button (click)="dec(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">−</button>
                <input [(ngModel)]="row.qty" type="number" min="0" step="1"
                       class="w-16 bg-gray-700 text-white text-center rounded-lg px-2 py-1 border border-gray-600 focus:outline-none text-sm" />
                <button (click)="inc(row, 1)" class="w-8 h-8 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold touch-manipulation">+</button>
              </div>
            }
          </div>
        }

        <textarea [(ngModel)]="editNotes" rows="2" placeholder="Notas (opcional)"
                  class="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-sm"></textarea>

        <div class="space-y-1">
          <label class="text-gray-400 text-xs">Motivo de la corrección (aparecerá en el historial)</label>
          <textarea [(ngModel)]="editReason" rows="2" placeholder="Ej. Error al contar, se corrige valor real"
                    class="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-sm"></textarea>
        </div>
      </div>

      <div class="px-6 py-4 border-t border-gray-800 shrink-0 space-y-2">
        @if (editError) { <p class="text-red-400 text-sm">{{ editError }}</p> }
        <div class="flex gap-3">
          <button (click)="cancelEdit()"
                  class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl font-semibold touch-manipulation">
            Cancelar
          </button>
          <button (click)="saveEdit()" [disabled]="editing"
                  class="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold touch-manipulation">
            {{ editing ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </div>
    }

  </div>
}
```

- [ ] **Step 3: Angular build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Run all backend tests to confirm nothing broken**

```bash
cd helados-api && npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd helados-ui && git add src/app/features/inventory/ && git commit -m "feat: inventory shows 3 sections (conos/envases/bebidas) with beverage overlay"
```
