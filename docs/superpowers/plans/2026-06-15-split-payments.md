# Split Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `paymentMethod` field on `Order` with an `OrderPayment` child table, allowing one or two payment methods (QR and/or CASH) per order, with amounts that must sum exactly to `totalAmount`.

**Architecture:** New `OrderPayment` Prisma model holds method+amount per order. Backend validates no duplicates and sum = totalAmount before writing. Frontend step 4 gains three buttons — Solo QR / Solo Efectivo / Dividido — where "Dividido" reveals a method picker + amount input with auto-computed remainder.

**Tech Stack:** NestJS 11 + Prisma 5 + PostgreSQL (backend), Angular 18 standalone + Tailwind CSS (frontend), Jest + mock-Prisma (tests).

**Spec:** `docs/superpowers/specs/2026-06-15-split-payments-design.md`

---

## File map

| File | Change |
|------|--------|
| `helados-api/prisma/schema.prisma` | Add `OrderPayment` model; remove `Order.paymentMethod` |
| `helados-api/prisma/migrations/<ts>_add_order_payments/migration.sql` | Generated + manually edited for data migration |
| `helados-api/src/orders/dto/create-order.dto.ts` | Add `CreateOrderPaymentDto`; replace `paymentMethod` with `payments` |
| `helados-api/src/orders/orders.service.ts` | Add payment validation + writes; update `orderInclude` |
| `helados-api/src/orders/orders.service.spec.ts` | Update existing fixtures; add 3 new tests |
| `helados-ui/src/app/core/models/order.model.ts` | Add `OrderPaymentEntry`; replace `paymentMethod` with `payments` |
| `helados-ui/src/app/features/orders/new-order/new-order.component.ts` | New payment state fields + getters; update `placeOrder()` + `resetOrder()` |
| `helados-ui/src/app/features/orders/new-order/new-order.component.html` | Rewrite step 4 payment section; update step 5 badge |
| `helados-ui/src/app/features/orders/order-history/order-history.component.html` | Add payment breakdown in collapsed row + expanded detail |

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `helados-api/prisma/schema.prisma`
- Create: `helados-api/prisma/migrations/<auto>/migration.sql` (then hand-edit)

- [ ] **Step 1: Edit `schema.prisma`**

Replace the `Order` model and add `OrderPayment`. The full new block (replace lines 116–141 in the existing schema):

```prisma
model Order {
  id             String         @id @default(uuid())
  staffId        String
  staff          User           @relation(fields: [staffId], references: [id])
  couponId       String?
  coupon         Coupon?        @relation(fields: [couponId], references: [id])
  createdAt      DateTime       @default(now())
  payments       OrderPayment[]
  subtotal       Decimal        @db.Decimal(10, 2)
  discountAmount Decimal        @db.Decimal(10, 2) @default(0)
  totalAmount    Decimal        @db.Decimal(10, 2)
  notes          String?
  items          OrderItem[]
}

model OrderPayment {
  id            String        @id @default(uuid())
  orderId       String
  order         Order         @relation(fields: [orderId], references: [id])
  paymentMethod PaymentMethod
  amount        Decimal       @db.Decimal(10, 2)
}
```

- [ ] **Step 2: Create migration (without running)**

```bash
cd helados-api && npx prisma migrate dev --create-only --name add_order_payments
```

Expected: Prisma creates `prisma/migrations/<timestamp>_add_order_payments/migration.sql` and prints "Migration created".

- [ ] **Step 3: Add data migration to the SQL file**

Open the generated `migration.sql`. It will look roughly like:

```sql
-- CreateTable
CREATE TABLE "OrderPayment" ( ... );

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "paymentMethod";

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT ...
```

**Insert the data migration block between CreateTable and AlterTable:**

```sql
-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- Migrate existing orders: create one payment row per order
INSERT INTO "OrderPayment" ("id", "orderId", "paymentMethod", "amount")
SELECT gen_random_uuid(), "id", "paymentMethod", "totalAmount"
FROM "Order";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "paymentMethod";

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply migration and regenerate client**

```bash
cd helados-api && npx prisma migrate dev
```

Expected: "1 migration applied" and Prisma client regenerated. No errors.

- [ ] **Step 5: Verify migration applied**

```bash
PGPASSWORD=helados /Library/PostgreSQL/17/bin/psql -U helados -d helados_dev -c "\d \"OrderPayment\""
```

Expected: table with columns `id`, `orderId`, `paymentMethod`, `amount`.

- [ ] **Step 6: Commit**

```bash
git add helados-api/prisma/schema.prisma helados-api/prisma/migrations/
git commit -m "feat: add OrderPayment table, drop Order.paymentMethod"
```

---

## Task 2: Backend DTO update + failing tests (TDD RED)

**Files:**
- Modify: `helados-api/src/orders/dto/create-order.dto.ts`
- Modify: `helados-api/src/orders/orders.service.spec.ts`

- [ ] **Step 1: Rewrite `create-order.dto.ts`**

```typescript
import { IsArray, ArrayMinSize, ArrayMaxSize, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderPaymentDto {
  @IsEnum(['QR', 'CASH'])
  method: 'QR' | 'CASH';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;
}

export class CreateOrderItemToppingDto {
  @IsUUID()
  toppingId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderItemDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  flavorId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemToppingDto)
  toppings: CreateOrderItemToppingDto[];
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderPaymentDto)
  payments: CreateOrderPaymentDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
```

- [ ] **Step 2: Update existing fixtures + add new failing tests in `orders.service.spec.ts`**

Update the top-level `dto` and `fakeOrder` fixtures, update all coupon tests to carry the correct post-discount payment amount, and add three new tests:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';

const mockPrisma = {
  product: { findMany: jest.fn() },
  flavor: { findMany: jest.fn() },
  topping: { findMany: jest.fn() },
  order: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  coupon: { update: jest.fn() },
  $transaction: jest.fn(),
};

const mockCouponsService = { validate: jest.fn() };

const product  = { id: 'p1', name: 'Small Cone', basePrice: 5,   active: true, directSale: false };
const flavor   = { id: 'f1', name: 'Chocolate',  priceModifier: 1, active: true };
const topping1 = { id: 't1', name: 'Oreo',       unitPrice: 0.5, active: true, type: 'NORMAL' };
const topping2 = { id: 't2', name: 'Sprinkles',  unitPrice: 1,   active: true, type: 'NORMAL' };
const topping3 = { id: 't3', name: 'Caramel',    unitPrice: 2,   active: true, type: 'PREMIUM' };
const productWithAllowance = {
  id: 'p2', name: 'Container', basePrice: 7, active: true, directSale: false,
  includedToppingType: 'NORMAL', includedToppingQty: 2,
};
const flavor2 = { id: 'f2', name: 'Vanilla', priceModifier: 0, active: true };

// subtotal = 5+1 (base+modifier) + 0.5×2+1×1 (toppings) = 8
const dto = {
  payments: [{ method: 'QR' as const, amount: 8 }],
  items: [{
    productId: 'p1',
    flavorId:  'f1',
    toppings: [
      { toppingId: 't1', quantity: 2 },
      { toppingId: 't2', quantity: 1 },
    ],
  }],
};

const fakeOrder = {
  id: 'order1', staffId: 'staff1', couponId: null, coupon: null,
  staff: { id: 'staff1', name: 'Ana' },
  payments: [{ id: 'pay1', orderId: 'order1', paymentMethod: 'QR', amount: 8 }],
  subtotal: 8, discountAmount: 0, totalAmount: 8, notes: null,
  createdAt: new Date(), items: [],
};

function setupMocks() {
  mockPrisma.product.findMany.mockResolvedValue([product]);
  mockPrisma.flavor.findMany.mockResolvedValue([flavor]);
  mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.order.create.mockResolvedValue(fakeOrder);
}

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: CouponsService, useValue: mockCouponsService },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('calculates correct totals with no coupon', async () => {
      setupMocks();
      await service.create('staff1', dto);
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 0, totalAmount: 8 }),
        }),
      );
    });

    it('applies PERCENTAGE coupon correctly', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'SAVE10', discountType: 'PERCENTAGE', discountValue: 10 });
      mockPrisma.coupon.update.mockResolvedValue({});
      // totalAmount after 10% = 7.2 → payment must match
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 7.2 }], couponCode: 'SAVE10' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 0.8, totalAmount: 7.2 }),
        }),
      );
    });

    it('applies FIXED coupon correctly', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'SAVE3', discountType: 'FIXED', discountValue: 3 });
      mockPrisma.coupon.update.mockResolvedValue({});
      // totalAmount after $3 off = 5 → payment must match
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 5 }], couponCode: 'SAVE3' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 3, totalAmount: 5 }),
        }),
      );
    });

    it('caps FIXED discount at subtotal', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'BIG', discountType: 'FIXED', discountValue: 50 });
      mockPrisma.coupon.update.mockResolvedValue({});
      // totalAmount capped at 0 → payment must match
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 0 }], couponCode: 'BIG' });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 8, discountAmount: 8, totalAmount: 0 }),
        }),
      );
    });

    it('throws NotFoundException when product is missing or inactive', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      await expect(service.create('staff1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when flavor is missing or inactive', async () => {
      mockPrisma.product.findMany.mockResolvedValue([product]);
      mockPrisma.flavor.findMany.mockResolvedValue([]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      await expect(service.create('staff1', dto)).rejects.toThrow(NotFoundException);
    });

    it('increments coupon usesCount inside transaction', async () => {
      setupMocks();
      mockCouponsService.validate.mockResolvedValue({ id: 'c1', code: 'SAVE10', discountType: 'PERCENTAGE', discountValue: 10 });
      mockPrisma.coupon.update.mockResolvedValue({});
      await service.create('staff1', { ...dto, payments: [{ method: 'QR' as const, amount: 7.2 }], couponCode: 'SAVE10' });
      expect(mockPrisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { usesCount: { increment: 1 } },
      });
    });

    it('does not call coupon.update when no coupon used', async () => {
      setupMocks();
      await service.create('staff1', dto);
      expect(mockPrisma.coupon.update).not.toHaveBeenCalled();
    });

    it('toppings within NORMAL allowance are free', async () => {
      mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor2]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.order.create.mockResolvedValue(fakeOrder);
      // basePrice=7, priceModifier=0, 2 NORMAL included, 2 NORMAL selected → subtotal=7
      await service.create('staff1', {
        payments: [{ method: 'QR' as const, amount: 7 }],
        items: [{ productId: 'p2', flavorId: 'f2', toppings: [{ toppingId: 't1', quantity: 1 }, { toppingId: 't2', quantity: 1 }] }],
      });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtotal: 7, totalAmount: 7 }) }),
      );
    });

    it('toppings beyond NORMAL allowance are charged', async () => {
      mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor2]);
      mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.order.create.mockResolvedValue(fakeOrder);
      // t1 qty=2 consumes 2 free; t2 qty=1 charged 1×1=1 → subtotal=8
      await service.create('staff1', {
        payments: [{ method: 'QR' as const, amount: 8 }],
        items: [{ productId: 'p2', flavorId: 'f2', toppings: [{ toppingId: 't1', quantity: 2 }, { toppingId: 't2', quantity: 1 }] }],
      });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtotal: 8, totalAmount: 8 }) }),
      );
    });

    it('PREMIUM toppings are charged when product includes NORMAL', async () => {
      mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
      mockPrisma.flavor.findMany.mockResolvedValue([flavor2]);
      mockPrisma.topping.findMany.mockResolvedValue([topping3]);
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.order.create.mockResolvedValue(fakeOrder);
      // PREMIUM charged 1×2=2 → subtotal=9
      await service.create('staff1', {
        payments: [{ method: 'QR' as const, amount: 9 }],
        items: [{ productId: 'p2', flavorId: 'f2', toppings: [{ toppingId: 't3', quantity: 1 }] }],
      });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subtotal: 9, totalAmount: 9 }) }),
      );
    });

    it('stores unitPriceAtSale on each OrderItemTopping at time of order creation', async () => {
      setupMocks();
      await service.create('staff1', dto);
      const createCall = mockPrisma.order.create.mock.calls[0][0];
      const toppingsCreated = createCall.data.items.create[0].toppings.create;
      expect(toppingsCreated).toEqual([
        { toppingId: 't1', quantity: 2, unitPriceAtSale: 0.5 },
        { toppingId: 't2', quantity: 1, unitPriceAtSale: 1 },
      ]);
    });

    // ── NEW TESTS ──────────────────────────────────────────────────────────────

    it('rejects duplicate payment methods', async () => {
      setupMocks();
      await expect(
        service.create('staff1', {
          ...dto,
          payments: [{ method: 'QR' as const, amount: 4 }, { method: 'QR' as const, amount: 4 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when payment amounts do not sum to totalAmount', async () => {
      setupMocks();
      await expect(
        service.create('staff1', {
          ...dto,
          payments: [{ method: 'QR' as const, amount: 5 }], // subtotal is 8, not 5
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts two payments summing to totalAmount', async () => {
      setupMocks();
      await service.create('staff1', {
        ...dto,
        payments: [{ method: 'QR' as const, amount: 5 }, { method: 'CASH' as const, amount: 3 }],
      });
      const createCall = mockPrisma.order.create.mock.calls[0][0];
      expect(createCall.data.payments.create).toEqual([
        { paymentMethod: 'QR',   amount: 5 },
        { paymentMethod: 'CASH', amount: 3 },
      ]);
    });
  });

  describe('findAll', () => {
    it('returns orders ordered by createdAt desc with no filter', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      await service.findAll({});
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('filters by date range when from/to provided', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      await service.findAll({ from: '2026-06-13', to: '2026-06-13' });
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }) },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Run tests — verify they FAIL**

```bash
cd helados-api && npm test -- --testPathPattern=orders.service
```

Expected output: the 3 new tests fail (`rejects duplicate payment methods`, `rejects when payment amounts do not sum to totalAmount`, `accepts two payments summing to totalAmount`). Some existing tests may also fail because the service still uses `paymentMethod`. That is expected.

---

## Task 3: Backend service implementation (TDD GREEN)

**Files:**
- Modify: `helados-api/src/orders/orders.service.ts`

- [ ] **Step 1: Rewrite `orders.service.ts`**

```typescript
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

const orderInclude = {
  payments: true,
  items: {
    include: {
      product: { select: { id: true, name: true, type: true, size: true, directSale: true } },
      flavor:  { select: { id: true, name: true } },
      toppings: { include: { topping: { select: { id: true, name: true } } } },
    },
  },
  staff:  { select: { id: true, name: true } },
  coupon: { select: { id: true, code: true } },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private couponsService: CouponsService,
  ) {}

  async create(staffId: string, dto: CreateOrderDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('El pedido debe tener al menos un ítem');
    }

    const productIds = dto.items.map(i => i.productId);
    const flavorIds  = dto.items.filter(i => i.flavorId).map(i => i.flavorId!);
    const toppingIds = [...new Set(dto.items.flatMap(i => i.toppings.map(t => t.toppingId)))];

    const [products, flavors, toppings] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds }, active: true } }),
      flavorIds.length
        ? this.prisma.flavor.findMany({ where: { id: { in: flavorIds }, active: true } })
        : Promise.resolve([]),
      toppingIds.length
        ? this.prisma.topping.findMany({ where: { id: { in: toppingIds }, active: true } })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p] as const));
    const flavorMap  = new Map(flavors.map(f  => [f.id, f] as const));
    const toppingMap = new Map(toppings.map(t => [t.id, t] as const));

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado o inactivo`);
      }
      if (product.directSale) {
        if (item.flavorId) {
          throw new BadRequestException(`El producto "${product.name}" es de venta directa y no admite sabor`);
        }
        if (item.toppings.length > 0) {
          throw new BadRequestException(`El producto "${product.name}" es de venta directa y no admite toppings`);
        }
      } else {
        if (!item.flavorId || !flavorMap.has(item.flavorId)) {
          throw new NotFoundException(`Sabor ${item.flavorId ?? '(no especificado)'} no encontrado o inactivo`);
        }
        for (const t of item.toppings) {
          if (!toppingMap.has(t.toppingId)) {
            throw new NotFoundException(`Topping ${t.toppingId} no encontrado o inactivo`);
          }
        }
      }
    }

    const itemTotals: number[] = [];
    let subtotal = 0;

    for (const item of dto.items) {
      const product   = productMap.get(item.productId)!;
      const flavor    = item.flavorId ? flavorMap.get(item.flavorId) : undefined;
      const itemTotal = Number(product.basePrice) + (flavor ? Number(flavor.priceModifier) : 0);

      let remainingFree = product.includedToppingQty ?? 0;
      const toppingCost = item.toppings.reduce((sum, t) => {
        const topping = toppingMap.get(t.toppingId)!;
        if (topping.type === product.includedToppingType && remainingFree > 0) {
          const freeQty    = Math.min(t.quantity, remainingFree);
          const chargedQty = t.quantity - freeQty;
          remainingFree -= freeQty;
          return sum + chargedQty * Number(topping.unitPrice);
        }
        return sum + t.quantity * Number(topping.unitPrice);
      }, 0);

      itemTotals.push(itemTotal);
      subtotal += itemTotal + toppingCost;
    }

    let couponId: string | undefined;
    let discountAmount = 0;

    if (dto.couponCode) {
      const coupon = await this.couponsService.validate(dto.couponCode);
      couponId = coupon.id;
      discountAmount = coupon.discountType === 'PERCENTAGE'
        ? subtotal * Number(coupon.discountValue) / 100
        : Math.min(Number(coupon.discountValue), subtotal);
    }

    subtotal       = Math.round(subtotal       * 100) / 100;
    discountAmount = Math.round(discountAmount * 100) / 100;
    const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    // Validate payments
    const methods = dto.payments.map(p => p.method);
    if (new Set(methods).size !== methods.length) {
      throw new BadRequestException('No se puede usar el mismo método de pago más de una vez');
    }

    const paymentsTotal = Math.round(dto.payments.reduce((s, p) => s + p.amount, 0) * 100);
    const expectedTotal = Math.round(totalAmount * 100);
    if (paymentsTotal !== expectedTotal) {
      throw new UnprocessableEntityException('La suma de los pagos no coincide con el total del pedido');
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          staffId,
          couponId,
          payments: {
            create: dto.payments.map(p => ({
              paymentMethod: p.method,
              amount:        p.amount,
            })),
          },
          subtotal,
          discountAmount,
          totalAmount,
          notes: dto.notes,
          items: {
            create: dto.items.map((item, idx) => ({
              productId: item.productId,
              flavorId:  item.flavorId ?? null,
              itemTotal: itemTotals[idx],
              toppings: {
                create: item.toppings.map(t => ({
                  toppingId:       t.toppingId,
                  quantity:        t.quantity,
                  unitPriceAtSale: toppingMap.get(t.toppingId)!.unitPrice,
                })),
              },
            })),
          },
        },
        include: orderInclude,
      });

      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usesCount: { increment: 1 } },
        });
      }

      return order;
    });
  }

  async findAll(query: GetOrdersQueryDto) {
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setDate(toDate.getDate() + 1);
        where.createdAt.lte = toDate;
      }
    }
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException(`Pedido ${id} no encontrado`);
    return order;
  }
}
```

- [ ] **Step 2: Run tests — verify all pass**

```bash
cd helados-api && npm test
```

Expected: `Tests: 72 passed` (was 69; added 3 new). No failures.

- [ ] **Step 3: Commit**

```bash
git add helados-api/src/orders/dto/create-order.dto.ts \
        helados-api/src/orders/orders.service.ts \
        helados-api/src/orders/orders.service.spec.ts
git commit -m "feat: split payment validation and persistence in OrdersService"
```

---

## Task 4: Frontend models + new-order component

**Files:**
- Modify: `helados-ui/src/app/core/models/order.model.ts`
- Modify: `helados-ui/src/app/features/orders/new-order/new-order.component.ts`
- Modify: `helados-ui/src/app/features/orders/new-order/new-order.component.html`

> **Note:** After Step 1 (models), TypeScript compilation will break until Step 2 (component TS) is complete. Do NOT commit between Steps 1 and 3.

- [ ] **Step 1: Rewrite `order.model.ts`**

```typescript
import { DiscountType } from './coupon.model';

export type PaymentMethod = 'QR' | 'CASH';

export interface OrderPaymentEntry {
  method: PaymentMethod;
  amount: number;
}

export interface OrderItemTopping {
  id: string;
  toppingId: string;
  topping: { id: string; name: string };
  quantity: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  product: { id: string; name: string; type: string; size: string; directSale: boolean };
  flavorId: string | null;
  flavor: { id: string; name: string } | null;
  itemTotal: number;
  toppings: OrderItemTopping[];
}

export interface Order {
  id: string;
  staffId: string;
  staff: { id: string; name: string };
  couponId: string | null;
  coupon: { id: string; code: string } | null;
  payments: OrderPaymentEntry[];
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
}

export interface CreateOrderItemToppingPayload {
  toppingId: string;
  quantity: number;
}

export interface CreateOrderItemPayload {
  productId: string;
  flavorId?: string;
  toppings: CreateOrderItemToppingPayload[];
}

export interface CreateOrderPayload {
  payments: OrderPaymentEntry[];
  items: CreateOrderItemPayload[];
  couponCode?: string;
  notes?: string;
}
```

- [ ] **Step 2: Rewrite `new-order.component.ts`**

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ProductService } from '../../../core/services/product.service';
import { FlavorService } from '../../../core/services/flavor.service';
import { ToppingService } from '../../../core/services/topping.service';
import { CouponService } from '../../../core/services/coupon.service';
import { OrderService } from '../../../core/services/order.service';
import { Product } from '../../../core/models/product.model';
import { Flavor } from '../../../core/models/flavor.model';
import { Topping } from '../../../core/models/topping.model';
import { CouponValidation } from '../../../core/models/coupon.model';
import { CreateOrderPayload, OrderPaymentEntry, PaymentMethod } from '../../../core/models/order.model';

interface FinishedItem {
  product: Product;
  flavor: Flavor | null;
  toppings: { topping: Topping; quantity: number }[];
  itemTotal: number;
  toppingTotal: number;
}

type Step = 1 | 2 | 3 | 4 | 5;

@Component({
  selector: 'app-new-order',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './new-order.component.html',
})
export class NewOrderComponent implements OnInit {
  private productSvc = inject(ProductService);
  private flavorSvc  = inject(FlavorService);
  private toppingSvc = inject(ToppingService);
  private couponSvc  = inject(CouponService);
  private orderSvc   = inject(OrderService);

  step: Step = 1;
  loading = true;

  products: Product[] = [];
  flavors:  Flavor[]  = [];
  toppings: Topping[] = [];

  items: FinishedItem[] = [];

  draftProduct?: Product;
  draftFlavor?: Flavor;
  toppingQties = new Map<string, number>();

  // Payment state
  paymentMode: 'QR' | 'CASH' | 'SPLIT' | null = null;
  splitMethod: PaymentMethod | null = null;
  splitAmount: number | null = null;

  couponCode = '';
  couponResult: CouponValidation | null = null;
  couponError = '';
  couponLoading = false;

  notes = '';
  submitting = false;
  submitError = '';
  orderSuccess = false;

  ngOnInit() {
    forkJoin({
      products: this.productSvc.getAll(),
      flavors:  this.flavorSvc.getAll(),
      toppings: this.toppingSvc.getAll(),
    }).subscribe({
      next: ({ products, flavors, toppings }) => {
        this.products = products.filter(p => p.active);
        this.flavors  = flavors.filter(f => f.active);
        this.toppings = toppings.filter(t => t.active);
        this.loading  = false;
      },
    });
  }

  selectProduct(product: Product) {
    this.draftProduct = product;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    if (product.directSale) {
      this.items.push({
        product,
        flavor:       null,
        toppings:     [],
        itemTotal:    Number(product.basePrice),
        toppingTotal: 0,
      });
      this.draftProduct = undefined;
      this.step = 1;
    } else {
      this.step = 2;
    }
  }

  selectFlavor(flavor: Flavor) {
    this.draftFlavor = flavor;
    this.toppingQties.clear();
    this.step = 3;
  }

  backToStep1() {
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 1;
  }

  backToStep2() { this.step = 2; }

  getToppingQty(toppingId: string): number {
    return this.toppingQties.get(toppingId) ?? 0;
  }

  adjustTopping(toppingId: string, delta: number) {
    const next = Math.max(0, (this.toppingQties.get(toppingId) ?? 0) + delta);
    if (next === 0) this.toppingQties.delete(toppingId);
    else            this.toppingQties.set(toppingId, next);
  }

  private buildFinishedItem(): FinishedItem {
    const product      = this.draftProduct!;
    const flavor       = this.draftFlavor!;
    const itemTotal    = Number(product.basePrice) + Number(flavor.priceModifier);
    const toppingsList = this.toppings
      .filter(t => (this.toppingQties.get(t.id) ?? 0) > 0)
      .map(t => ({ topping: t, quantity: this.toppingQties.get(t.id)! }));
    let remainingFree = product.includedToppingQty ?? 0;
    const toppingTotal = toppingsList.reduce((s, ts) => {
      if (ts.topping.type === product.includedToppingType && remainingFree > 0) {
        const freeQty = Math.min(ts.quantity, remainingFree);
        remainingFree -= freeQty;
        return s + (ts.quantity - freeQty) * Number(ts.topping.unitPrice);
      }
      return s + ts.quantity * Number(ts.topping.unitPrice);
    }, 0);
    return { product, flavor, toppings: toppingsList, itemTotal, toppingTotal };
  }

  addAnotherItem() {
    this.items.push(this.buildFinishedItem());
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 1;
  }

  proceedToPayment() {
    this.items.push(this.buildFinishedItem());
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 4;
  }

  proceedToPaymentFromCart() {
    this.step = 4;
  }

  removeItem(index: number) {
    this.items.splice(index, 1);
  }

  editItem(index: number) {
    const item = this.items.splice(index, 1)[0];
    this.draftProduct = item.product;
    if (item.product.directSale) {
      return;
    }
    this.draftFlavor = item.flavor ?? undefined;
    this.toppingQties.clear();
    for (const ts of item.toppings) {
      this.toppingQties.set(ts.topping.id, ts.quantity);
    }
    this.step = item.flavor ? 3 : 2;
  }

  validateCoupon() {
    const code = this.couponCode.trim().toUpperCase();
    if (!code) return;
    this.couponLoading = true;
    this.couponError   = '';
    this.couponResult  = null;
    this.couponSvc.validate(code).subscribe({
      next:  (r) => { this.couponResult = r; this.couponLoading = false; },
      error: (e) => { this.couponError = e?.error?.message ?? 'Cupón inválido'; this.couponLoading = false; },
    });
  }

  clearCoupon() {
    this.couponCode   = '';
    this.couponResult = null;
    this.couponError  = '';
  }

  get subtotal(): number {
    return Math.round(this.items.reduce((s, i) => s + i.itemTotal + i.toppingTotal, 0) * 100) / 100;
  }

  get discountAmount(): number {
    if (!this.couponResult) return 0;
    const s = this.subtotal;
    const d = this.couponResult.discountType === 'PERCENTAGE'
      ? s * this.couponResult.discountValue / 100
      : Math.min(this.couponResult.discountValue, s);
    return Math.round(d * 100) / 100;
  }

  get total(): number {
    return Math.round((this.subtotal - this.discountAmount) * 100) / 100;
  }

  get splitOtherMethod(): PaymentMethod {
    return this.splitMethod === 'QR' ? 'CASH' : 'QR';
  }

  get splitRemainder(): number {
    if (this.splitAmount === null) return this.total;
    return Math.round((this.total - this.splitAmount) * 100) / 100;
  }

  get isPaymentReady(): boolean {
    if (this.paymentMode === 'QR' || this.paymentMode === 'CASH') return true;
    if (this.paymentMode === 'SPLIT') {
      return this.splitMethod !== null &&
             this.splitAmount !== null &&
             this.splitAmount > 0 &&
             this.splitAmount < this.total;
    }
    return false;
  }

  get previewPayments(): OrderPaymentEntry[] {
    if (this.paymentMode === 'QR' || this.paymentMode === 'CASH') {
      return [{ method: this.paymentMode, amount: this.total }];
    }
    if (this.paymentMode === 'SPLIT' && this.splitMethod && this.splitAmount) {
      return [
        { method: this.splitMethod,      amount: this.splitAmount },
        { method: this.splitOtherMethod, amount: this.splitRemainder },
      ];
    }
    return [];
  }

  selectPaymentMode(mode: 'QR' | 'CASH' | 'SPLIT') {
    this.paymentMode = mode;
    this.splitMethod = null;
    this.splitAmount = null;
  }

  selectSplitMethod(method: PaymentMethod) {
    this.splitMethod = method;
    this.splitAmount = null;
  }

  placeOrder() {
    if (!this.isPaymentReady) return;
    this.submitting  = true;
    this.submitError = '';
    const payload: CreateOrderPayload = {
      payments: this.previewPayments,
      items: this.items.map(item => ({
        productId: item.product.id,
        flavorId:  item.flavor?.id,
        toppings:  item.toppings.map(ts => ({ toppingId: ts.topping.id, quantity: ts.quantity })),
      })),
      couponCode: this.couponResult ? this.couponCode.trim().toUpperCase() : undefined,
      notes: this.notes || undefined,
    };
    this.orderSvc.create(payload).subscribe({
      next: () => {
        this.submitting   = false;
        this.orderSuccess = true;
        setTimeout(() => this.resetOrder(), 2500);
      },
      error: (e) => {
        this.submitting  = false;
        this.submitError = e?.error?.message ?? 'Error al registrar pedido';
      },
    });
  }

  resetOrder() {
    this.step         = 1;
    this.items        = [];
    this.draftProduct = undefined;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.paymentMode  = null;
    this.splitMethod  = null;
    this.splitAmount  = null;
    this.couponCode   = '';
    this.couponResult = null;
    this.couponError  = '';
    this.notes        = '';
    this.submitError  = '';
    this.orderSuccess = false;
  }

  formatPrice(n: number | string) { return `$${Number(n).toFixed(2)}`; }

  toppingSummary(item: FinishedItem): string {
    return item.toppings.map(ts => `${ts.topping.name} ×${ts.quantity}`).join(', ');
  }
}
```

- [ ] **Step 3: Update `new-order.component.html` — step 4 payment section and step 5 badge**

Replace the `<!-- STEP 4: PAGO + CUPÓN -->` section (the payment method block inside it, lines 200–229) with the three-button + split UI:

```html
    <!-- STEP 4: PAGO + CUPÓN -->
    @if (step === 4) {
      <div class="flex-1 overflow-y-auto p-6 space-y-6">

        <!-- Payment mode -->
        <div class="space-y-3">
          <h2 class="text-xl font-bold text-white">Método de pago</h2>
          <div class="flex gap-3">
            <button
              (click)="selectPaymentMode('QR')"
              class="flex-1 py-4 rounded-2xl font-bold text-lg border-2 transition-colors touch-manipulation"
              [class.bg-purple-600]="paymentMode === 'QR'"
              [class.border-purple-600]="paymentMode === 'QR'"
              [class.text-white]="paymentMode === 'QR'"
              [class.bg-gray-900]="paymentMode !== 'QR'"
              [class.border-gray-700]="paymentMode !== 'QR'"
              [class.text-gray-300]="paymentMode !== 'QR'"
            >📱 Solo QR</button>
            <button
              (click)="selectPaymentMode('CASH')"
              class="flex-1 py-4 rounded-2xl font-bold text-lg border-2 transition-colors touch-manipulation"
              [class.bg-purple-600]="paymentMode === 'CASH'"
              [class.border-purple-600]="paymentMode === 'CASH'"
              [class.text-white]="paymentMode === 'CASH'"
              [class.bg-gray-900]="paymentMode !== 'CASH'"
              [class.border-gray-700]="paymentMode !== 'CASH'"
              [class.text-gray-300]="paymentMode !== 'CASH'"
            >💵 Solo Efectivo</button>
            <button
              (click)="selectPaymentMode('SPLIT')"
              class="flex-1 py-4 rounded-2xl font-bold text-lg border-2 transition-colors touch-manipulation"
              [class.bg-purple-600]="paymentMode === 'SPLIT'"
              [class.border-purple-600]="paymentMode === 'SPLIT'"
              [class.text-white]="paymentMode === 'SPLIT'"
              [class.bg-gray-900]="paymentMode !== 'SPLIT'"
              [class.border-dashed]="paymentMode !== 'SPLIT'"
              [class.border-gray-700]="paymentMode !== 'SPLIT'"
              [class.text-gray-300]="paymentMode !== 'SPLIT'"
            >⚡ Dividido</button>
          </div>

          <!-- Split sub-UI -->
          @if (paymentMode === 'SPLIT') {
            <div class="bg-gray-900 rounded-2xl p-4 space-y-3">
              <p class="text-gray-400 text-sm">¿Cuánto paga con...?</p>
              <div class="flex gap-2">
                <button
                  (click)="selectSplitMethod('QR')"
                  class="flex-1 py-2.5 rounded-xl font-semibold border-2 transition-colors touch-manipulation"
                  [class.bg-purple-600]="splitMethod === 'QR'"
                  [class.border-purple-600]="splitMethod === 'QR'"
                  [class.text-white]="splitMethod === 'QR'"
                  [class.bg-gray-800]="splitMethod !== 'QR'"
                  [class.border-gray-600]="splitMethod !== 'QR'"
                  [class.text-gray-300]="splitMethod !== 'QR'"
                >📱 QR</button>
                <button
                  (click)="selectSplitMethod('CASH')"
                  class="flex-1 py-2.5 rounded-xl font-semibold border-2 transition-colors touch-manipulation"
                  [class.bg-purple-600]="splitMethod === 'CASH'"
                  [class.border-purple-600]="splitMethod === 'CASH'"
                  [class.text-white]="splitMethod === 'CASH'"
                  [class.bg-gray-800]="splitMethod !== 'CASH'"
                  [class.border-gray-600]="splitMethod !== 'CASH'"
                  [class.text-gray-300]="splitMethod !== 'CASH'"
                >💵 Efectivo</button>
              </div>
              @if (splitMethod) {
                <div>
                  <label class="block text-gray-400 text-sm mb-1">
                    Monto en {{ splitMethod === 'QR' ? 'QR' : 'Efectivo' }}
                  </label>
                  <input
                    [(ngModel)]="splitAmount"
                    type="number"
                    [min]="0.01"
                    [max]="total - 0.01"
                    step="0.01"
                    placeholder="0.00"
                    class="w-full bg-gray-800 text-white text-xl font-bold rounded-xl px-4 py-3 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                @if (splitAmount && splitAmount > 0 && splitAmount < total) {
                  <div class="flex justify-between items-center bg-gray-800 rounded-xl px-4 py-3">
                    <span class="text-gray-400 text-sm">
                      Resto en {{ splitOtherMethod === 'QR' ? 'QR' : 'Efectivo' }}
                    </span>
                    <span class="text-purple-300 font-bold text-lg">{{ formatPrice(splitRemainder) }}</span>
                  </div>
                }
              }
            </div>
          }
        </div>

        <!-- Coupon (unchanged) -->
        <div class="space-y-3">
          <h2 class="text-xl font-bold text-white">Cupón de descuento <span class="text-gray-500 font-normal text-sm">(opcional)</span></h2>
          <div class="flex gap-2">
            <input
              [(ngModel)]="couponCode"
              type="text"
              placeholder="Ej. VERANO10"
              (keyup.enter)="validateCoupon()"
              class="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 uppercase text-lg tracking-wider"
            />
            <button
              (click)="validateCoupon()"
              [disabled]="couponLoading || !couponCode.trim()"
              class="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-semibold touch-manipulation"
            >{{ couponLoading ? '...' : 'Validar' }}</button>
          </div>
          @if (couponResult) {
            <div class="bg-green-900/40 border border-green-700 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p class="text-green-300 font-bold">{{ couponResult.code }}</p>
                <p class="text-green-400 text-sm">
                  {{ couponResult.discountType === 'PERCENTAGE' ? couponResult.discountValue + '% de descuento' : '$' + couponResult.discountValue + ' de descuento' }}
                </p>
              </div>
              <button (click)="clearCoupon()" class="text-gray-400 hover:text-white text-xl touch-manipulation">✕</button>
            </div>
          }
          @if (couponError) {
            <p class="text-red-400 text-sm">{{ couponError }}</p>
          }
        </div>

        <!-- Price summary (unchanged) -->
        <div class="bg-gray-900 rounded-xl p-4 space-y-1 text-sm">
          <div class="flex justify-between text-gray-300">
            <span>{{ items.length }} ítem{{ items.length !== 1 ? 's' : '' }}</span>
            <span>{{ formatPrice(subtotal) }}</span>
          </div>
          @if (couponResult) {
            <div class="flex justify-between text-green-400">
              <span>Descuento</span>
              <span>-{{ formatPrice(discountAmount) }}</span>
            </div>
          }
          <div class="flex justify-between text-white font-bold text-base border-t border-gray-700 pt-2 mt-2">
            <span>Total</span>
            <span>{{ formatPrice(total) }}</span>
          </div>
        </div>

      </div>
      <div class="flex gap-3 px-5 py-3 bg-gray-900 border-t border-gray-800 shrink-0">
        <button (click)="step = 1" class="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2.5 rounded-xl touch-manipulation">
          ← Atrás
        </button>
        <button
          (click)="step = 5"
          [disabled]="!isPaymentReady"
          class="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold touch-manipulation"
        >
          {{ isPaymentReady ? 'Confirmar →' : 'Selecciona método de pago' }}
        </button>
      </div>
    }
```

Also replace the step 5 payment badge block (the `@if (paymentMethod === 'QR')` block inside step 5, lines 303–308) with:

```html
          <div class="flex flex-wrap gap-2">
            @for (p of previewPayments; track p.method) {
              @if (p.method === 'QR') {
                <span class="text-sm font-medium px-3 py-1 rounded-full bg-purple-500/20 text-purple-300">📱 QR {{ formatPrice(p.amount) }}</span>
              } @else {
                <span class="text-sm font-medium px-3 py-1 rounded-full bg-green-500/20 text-green-300">💵 Efectivo {{ formatPrice(p.amount) }}</span>
              }
            }
          </div>
```

- [ ] **Step 4: Angular build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -10
```

Expected: "Application bundle generation complete." No errors.

- [ ] **Step 5: Commit**

```bash
git add helados-ui/src/app/core/models/order.model.ts \
        helados-ui/src/app/features/orders/new-order/new-order.component.ts \
        helados-ui/src/app/features/orders/new-order/new-order.component.html
git commit -m "feat: split payment UI in new-order component (step 4 + step 5 badge)"
```

---

## Task 5: Order history payment display

**Files:**
- Modify: `helados-ui/src/app/features/orders/order-history/order-history.component.html`

- [ ] **Step 1: Add payment info to collapsed row metadata**

In the collapsed row `<div class="flex items-center gap-3 mt-0.5 text-xs text-gray-400">` block, add after the coupon span:

```html
                <span>·</span>
                @if (order.payments.length === 1) {
                  <span>{{ order.payments[0].method === 'QR' ? '📱 QR' : '💵 Efectivo' }}</span>
                } @else {
                  <span>📱 QR + 💵 Efectivo</span>
                }
```

- [ ] **Step 2: Add payment breakdown to expanded detail**

In the expanded detail, after the total row (`<div class="flex justify-between text-white font-bold ...">`) and before `</div>` closing the `text-sm space-y-1 pt-1` block, add:

```html
                <div class="flex flex-wrap gap-1.5 pt-1">
                  @for (p of order.payments; track p.method) {
                    @if (p.method === 'QR') {
                      <span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">📱 QR {{ formatPrice(p.amount) }}</span>
                    } @else {
                      <span class="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300">💵 Efectivo {{ formatPrice(p.amount) }}</span>
                    }
                  }
                </div>
```

- [ ] **Step 3: Angular build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -10
```

Expected: "Application bundle generation complete." No errors.

- [ ] **Step 4: Run API tests one final time**

```bash
cd helados-api && npm test
```

Expected: 72 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add helados-ui/src/app/features/orders/order-history/order-history.component.html
git commit -m "feat: show payment breakdown in order history"
```
