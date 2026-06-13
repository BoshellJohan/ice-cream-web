# Plan 3: Order Flow & History

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the core staff workflow — a 5-step visual order builder and an order history page — backed by a NestJS Orders module that validates catalog references, calculates totals, and applies coupons atomically.

**Architecture:** The NestJS Orders module imports `CouponsService` (already exported from Plan 2) to reuse coupon validation and increments `usesCount` inside the same `$transaction` as order creation. The Angular New Order component manages a multi-item draft state locally (no API calls until "Confirmar pedido"), cycling through steps 1→2→3 per item and proceeding to coupon + confirm when the user is done adding items.

**Tech Stack:** NestJS 11 + Prisma 5 (`$transaction`) + class-validator; Angular 18 standalone + RxJS `forkJoin` + Tailwind CSS.

---

## Prisma schema status

**Already done in Plan 1.** `Order`, `OrderItem`, `OrderItemTopping` models are in `schema.prisma` and the initial migration (`20260613043440_init`) creates all 10 tables. No schema changes needed.

---

## File Map

### helados-api/src/
```
orders/
  dto/create-order.dto.ts
  dto/get-orders-query.dto.ts
  orders.service.ts
  orders.service.spec.ts
  orders.controller.ts
  orders.module.ts
```
Modify: `helados-api/src/app.module.ts`

### helados-ui/src/app/
```
core/
  models/
    order.model.ts
  services/
    order.service.ts

features/
  orders/
    new-order/
      new-order.component.ts    ← replaces Plan 1 stub
      new-order.component.html  ← create
    order-history/
      order-history.component.ts    ← replaces Plan 1 stub
      order-history.component.html  ← create
```

---

## Task 1: OrdersService — DTOs + price calculation + tests

**Files:**
- Create: `helados-api/src/orders/dto/create-order.dto.ts`
- Create: `helados-api/src/orders/dto/get-orders-query.dto.ts`
- Create: `helados-api/src/orders/orders.service.ts`
- Create: `helados-api/src/orders/orders.service.spec.ts`

**Context:** Work in `helados-app/.worktrees/plan-3-orders/helados-api/`. PrismaModule is global. `CouponsService` is available by importing `CouponsModule` — that's wired in Task 2. For now the service just declares it in its constructor. Price rules: `item_total = product.basePrice + flavor.priceModifier`. `subtotal = Σ item_totals + Σ (topping.unitPrice × quantity)`. `discount = subtotal × pct/100` for PERCENTAGE or `min(value, subtotal)` for FIXED. All values rounded to 2 decimal places before DB write.

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/orders/dto/create-order.dto.ts`:
```typescript
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsUUID()
  flavorId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemToppingDto)
  toppings: CreateOrderItemToppingDto[];
}

export class CreateOrderDto {
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

Create `helados-api/src/orders/dto/get-orders-query.dto.ts`:
```typescript
import { IsDateString, IsOptional } from 'class-validator';

export class GetOrdersQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
```

- [ ] **Step 2: Write failing tests**

Create `helados-api/src/orders/orders.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

// Test catalog entities (numbers — service converts with Number())
const product = { id: 'p1', name: 'Small Cone', basePrice: 5, active: true };
const flavor  = { id: 'f1', name: 'Chocolate',  priceModifier: 1, active: true };
const topping1 = { id: 't1', name: 'Oreo',       unitPrice: 0.5, active: true };
const topping2 = { id: 't2', name: 'Sprinkles',  unitPrice: 1,   active: true };

// 1 item: itemTotal = 5+1 = 6; toppings = 0.5×2 + 1×1 = 2; subtotal = 8
const dto = {
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
        { provide: PrismaService,   useValue: mockPrisma },
        { provide: CouponsService,  useValue: mockCouponsService },
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
      await service.create('staff1', { ...dto, couponCode: 'SAVE10' });
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
      await service.create('staff1', { ...dto, couponCode: 'SAVE3' });
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
      await service.create('staff1', { ...dto, couponCode: 'BIG' });
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
      await service.create('staff1', { ...dto, couponCode: 'SAVE10' });
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

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd helados-api
npm test -- --testPathPattern=orders.service 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './orders.service'`

- [ ] **Step 4: Implement OrdersService**

Create `helados-api/src/orders/orders.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

const orderInclude = {
  items: {
    include: {
      product: { select: { id: true, name: true, type: true, size: true } },
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

    const productIds  = dto.items.map(i => i.productId);
    const flavorIds   = dto.items.map(i => i.flavorId);
    const toppingIds  = [...new Set(dto.items.flatMap(i => i.toppings.map(t => t.toppingId)))];

    const [products, flavors, toppings] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds }, active: true } }),
      this.prisma.flavor.findMany({  where: { id: { in: flavorIds  }, active: true } }),
      toppingIds.length
        ? this.prisma.topping.findMany({ where: { id: { in: toppingIds }, active: true } })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p]));
    const flavorMap  = new Map(flavors.map(f  => [f.id, f]));
    const toppingMap = new Map(toppings.map(t => [t.id, t]));

    for (const item of dto.items) {
      if (!productMap.has(item.productId)) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado o inactivo`);
      }
      if (!flavorMap.has(item.flavorId)) {
        throw new NotFoundException(`Sabor ${item.flavorId} no encontrado o inactivo`);
      }
      for (const t of item.toppings) {
        if (!toppingMap.has(t.toppingId)) {
          throw new NotFoundException(`Topping ${t.toppingId} no encontrado o inactivo`);
        }
      }
    }

    const itemTotals: number[] = [];
    let subtotal = 0;

    for (const item of dto.items) {
      const product    = productMap.get(item.productId)!;
      const flavor     = flavorMap.get(item.flavorId)!;
      const itemTotal  = Number(product.basePrice) + Number(flavor.priceModifier);
      const toppingCost = item.toppings.reduce((sum, t) => {
        return sum + Number(toppingMap.get(t.toppingId)!.unitPrice) * t.quantity;
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
        ? subtotal * coupon.discountValue / 100
        : Math.min(coupon.discountValue, subtotal);
    }

    subtotal       = Math.round(subtotal       * 100) / 100;
    discountAmount = Math.round(discountAmount * 100) / 100;
    const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          staffId,
          couponId,
          subtotal,
          discountAmount,
          totalAmount,
          notes: dto.notes,
          items: {
            create: dto.items.map((item, idx) => ({
              productId: item.productId,
              flavorId:  item.flavorId,
              itemTotal: itemTotals[idx],
              toppings:  {
                create: item.toppings.map(t => ({
                  toppingId: t.toppingId,
                  quantity:  t.quantity,
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

  findAll(query: GetOrdersQueryDto) {
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) {
        // include the full "to" day
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
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=orders.service 2>&1 | tail -15
```

Expected: PASS — 10 tests in `OrdersService` suite

- [ ] **Step 6: Commit**

```bash
git add helados-api/src/orders/dto/ helados-api/src/orders/orders.service.ts helados-api/src/orders/orders.service.spec.ts
git commit -m "feat: add OrdersService with price calculation, coupon application, and transaction"
```

---

## Task 2: OrdersController + OrdersModule + AppModule registration

**Files:**
- Create: `helados-api/src/orders/orders.controller.ts`
- Create: `helados-api/src/orders/orders.module.ts`
- Modify: `helados-api/src/app.module.ts`

**Context:** All three endpoints are accessible to any authenticated user (STAFF creates orders; STAFF + ADMIN view history). `req.user.sub` is the userId from JWT payload (set up in Plan 1 JwtStrategy).

- [ ] **Step 1: Create OrdersController**

Create `helados-api/src/orders/orders.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  create(
    @Request() req: { user: { sub: string } },
    @Body() dto: CreateOrderDto,
  ) {
    return this.orders.create(req.user.sub, dto);
  }

  @Get()
  findAll(@Query() query: GetOrdersQueryDto) {
    return this.orders.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }
}
```

- [ ] **Step 2: Create OrdersModule**

Create `helados-api/src/orders/orders.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { CouponsModule } from '../coupons/coupons.module';

@Module({
  imports: [CouponsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule {}
```

- [ ] **Step 3: Register in AppModule**

Replace `helados-api/src/app.module.ts`:
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
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run full test suite**

```bash
cd helados-api
npm test 2>&1 | tail -10
```

Expected: all 38 existing tests + 10 new orders tests = 48 tests passing

- [ ] **Step 5: Commit**

```bash
git add helados-api/src/orders/orders.controller.ts helados-api/src/orders/orders.module.ts helados-api/src/app.module.ts
git commit -m "feat: add OrdersController + OrdersModule (POST /orders, GET /orders, GET /orders/:id)"
```

---

## Task 3: Angular Order model + OrderService

**Files:**
- Create: `helados-ui/src/app/core/models/order.model.ts`
- Create: `helados-ui/src/app/core/services/order.service.ts`

**Context:** Work in `helados-app/.worktrees/plan-3-orders/helados-ui/`. `HttpClient` is provided globally with auth interceptor. Use `inject()` DI and `environment.apiUrl`.

- [ ] **Step 1: Create order model**

Create `helados-ui/src/app/core/models/order.model.ts`:
```typescript
import { DiscountType } from './coupon.model';

export interface OrderItemTopping {
  id: string;
  toppingId: string;
  topping: { id: string; name: string };
  quantity: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  product: { id: string; name: string; type: string; size: string };
  flavorId: string;
  flavor: { id: string; name: string };
  itemTotal: number;
  toppings: OrderItemTopping[];
}

export interface Order {
  id: string;
  staffId: string;
  staff: { id: string; name: string };
  couponId: string | null;
  coupon: { id: string; code: string } | null;
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
  flavorId: string;
  toppings: CreateOrderItemToppingPayload[];
}

export interface CreateOrderPayload {
  items: CreateOrderItemPayload[];
  couponCode?: string;
  notes?: string;
}
```

- [ ] **Step 2: Create OrderService**

Create `helados-ui/src/app/core/services/order.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Order, CreateOrderPayload } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/orders`;

  getAll(from?: string, to?: string) {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to)   params = params.set('to', to);
    return this.http.get<Order[]>(this.url, { params });
  }

  getOne(id: string) {
    return this.http.get<Order>(`${this.url}/${id}`);
  }

  create(body: CreateOrderPayload) {
    return this.http.post<Order>(this.url, body);
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/core/models/order.model.ts helados-ui/src/app/core/services/order.service.ts
git commit -m "feat: add Angular Order model and OrderService"
```

---

## Task 4: Angular New Order page (5-step flow)

**Files:**
- Modify: `helados-ui/src/app/features/orders/new-order/new-order.component.ts` (replaces stub)
- Create:  `helados-ui/src/app/features/orders/new-order/new-order.component.html`

**Context:** Staff tablet screen. No scrolling within a step is the goal (all choices visible at once). Flow: Step 1 → pick product (auto-advance to 2) → Step 2 → pick flavor (auto-advance to 3) → Step 3 → pick toppings then "Agregar otro ítem" (back to 1) or "Ir a pagar" (go to 4) → Step 4 → optional coupon → Step 5 → confirm + place order. After success: brief success overlay, then reset to step 1.

- [ ] **Step 1: Replace stub component**

Replace `helados-ui/src/app/features/orders/new-order/new-order.component.ts`:
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
import { CreateOrderPayload } from '../../../core/models/order.model';

interface FinishedItem {
  product: Product;
  flavor: Flavor;
  toppings: { topping: Topping; quantity: number }[];
  itemTotal: number;    // basePrice + priceModifier
  toppingTotal: number; // Σ(unitPrice × qty)
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

  // Completed items ready to submit
  items: FinishedItem[] = [];

  // Draft for the item currently being built
  draftProduct?: Product;
  draftFlavor?: Flavor;
  toppingQties = new Map<string, number>(); // toppingId → qty

  // Coupon step
  couponCode = '';
  couponResult: CouponValidation | null = null;
  couponError = '';
  couponLoading = false;

  // Confirm step
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
        this.products = products;
        this.flavors  = flavors;
        this.toppings = toppings;
        this.loading  = false;
      },
    });
  }

  // ── Step 1 ──────────────────────────────────────────────
  selectProduct(product: Product) {
    this.draftProduct = product;
    this.draftFlavor  = undefined;
    this.toppingQties.clear();
    this.step = 2;
  }

  // ── Step 2 ──────────────────────────────────────────────
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

  // ── Step 3 ──────────────────────────────────────────────
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
    const toppingTotal = toppingsList.reduce((s, ts) => s + Number(ts.topping.unitPrice) * ts.quantity, 0);
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

  backToStep2() { this.step = 2; }

  // ── Step 4 (coupon) ─────────────────────────────────────
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

  // ── Step 5 (confirm) ────────────────────────────────────
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

  placeOrder() {
    this.submitting  = true;
    this.submitError = '';
    const payload: CreateOrderPayload = {
      items: this.items.map(item => ({
        productId: item.product.id,
        flavorId:  item.flavor.id,
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
    this.couponCode   = '';
    this.couponResult = null;
    this.couponError  = '';
    this.notes        = '';
    this.submitError  = '';
    this.orderSuccess = false;
  }

  // helpers for template
  formatPrice(n: number | string) { return `$${Number(n).toFixed(2)}`; }
}
```

- [ ] **Step 2: Create template**

Create `helados-ui/src/app/features/orders/new-order/new-order.component.html`:
```html
<div class="h-screen flex flex-col bg-gray-950 overflow-hidden">

  <!-- Success overlay -->
  @if (orderSuccess) {
    <div class="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center z-50">
      <div class="text-6xl mb-4">✅</div>
      <p class="text-2xl font-bold text-white">¡Pedido registrado!</p>
      <p class="text-gray-400 mt-2">Iniciando nuevo pedido...</p>
    </div>
  }

  @if (loading) {
    <div class="flex-1 flex items-center justify-center">
      <p class="text-gray-400 text-lg">Cargando catálogo...</p>
    </div>
  } @else {

    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
      <div class="flex items-center gap-3">
        <span class="text-white font-bold text-lg">Nuevo Pedido</span>
        @if (items.length > 0) {
          <span class="bg-purple-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {{ items.length }} {{ items.length === 1 ? 'ítem' : 'ítems' }}
          </span>
        }
      </div>
      <!-- Step indicator -->
      <div class="flex items-center gap-1.5">
        @for (s of [1,2,3,4,5]; track s) {
          <div
            class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
            [class.bg-purple-600]="step === s"
            [class.text-white]="step === s"
            [class.bg-gray-700]="step !== s"
            [class.text-gray-400]="step !== s"
          >{{ s }}</div>
        }
      </div>
    </div>

    <!-- ── STEP 1: PRODUCTO ───────────────────────────── -->
    @if (step === 1) {
      <div class="flex-1 overflow-y-auto p-5">
        <p class="text-gray-400 text-sm mb-4">Selecciona el producto base</p>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
          @for (product of products; track product.id) {
            <button
              (click)="selectProduct(product)"
              class="bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-purple-500 rounded-2xl overflow-hidden text-left transition-colors touch-manipulation"
            >
              @if (product.imageUrl) {
                <img [src]="product.imageUrl" [alt]="product.name" class="w-full h-28 object-cover" />
              } @else {
                <div class="w-full h-28 bg-gray-800 flex items-center justify-center text-4xl">🍦</div>
              }
              <div class="p-3">
                <p class="font-bold text-white text-sm truncate">{{ product.name }}</p>
                <p class="text-xs text-gray-400 mt-0.5">{{ product.type }} · {{ product.size }}</p>
                <p class="text-purple-400 text-sm mt-1 font-medium">{{ formatPrice(product.basePrice) }}</p>
              </div>
            </button>
          }
        </div>
      </div>
    }

    <!-- ── STEP 2: SABOR ─────────────────────────────── -->
    @if (step === 2) {
      <div class="flex-1 overflow-y-auto p-5">
        <p class="text-gray-400 text-sm mb-4">Sabor para <span class="text-white font-medium">{{ draftProduct?.name }}</span></p>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
          @for (flavor of flavors; track flavor.id) {
            <button
              (click)="selectFlavor(flavor)"
              class="bg-gray-900 hover:bg-gray-800 border border-gray-700 hover:border-purple-500 rounded-2xl overflow-hidden text-left transition-colors touch-manipulation"
            >
              @if (flavor.imageUrl) {
                <img [src]="flavor.imageUrl" [alt]="flavor.name" class="w-full h-28 object-cover" />
              } @else {
                <div class="w-full h-28 bg-gray-800 flex items-center justify-center text-4xl">🍨</div>
              }
              <div class="p-3">
                <p class="font-bold text-white text-sm truncate">{{ flavor.name }}</p>
                @if (flavor.priceModifier > 0) {
                  <p class="text-purple-400 text-sm mt-1">+{{ formatPrice(flavor.priceModifier) }}</p>
                } @else {
                  <p class="text-gray-500 text-sm mt-1">Sin costo extra</p>
                }
              </div>
            </button>
          }
        </div>
      </div>
      <div class="px-5 py-3 bg-gray-900 border-t border-gray-800">
        <button (click)="backToStep1()" class="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2.5 rounded-xl touch-manipulation">
          ← Producto
        </button>
      </div>
    }

    <!-- ── STEP 3: TOPPINGS ──────────────────────────── -->
    @if (step === 3) {
      <div class="flex-1 overflow-y-auto p-5">
        <p class="text-gray-400 text-sm mb-4">Toppings para <span class="text-white font-medium">{{ draftProduct?.name }} — {{ draftFlavor?.name }}</span></p>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
          @for (topping of toppings; track topping.id) {
            <div
              class="bg-gray-900 border rounded-2xl overflow-hidden transition-colors"
              [class.border-purple-500]="getToppingQty(topping.id) > 0"
              [class.border-gray-700]="getToppingQty(topping.id) === 0"
            >
              <button (click)="adjustTopping(topping.id, 1)" class="w-full text-left touch-manipulation">
                @if (topping.imageUrl) {
                  <img [src]="topping.imageUrl" [alt]="topping.name" class="w-full h-24 object-cover" />
                } @else {
                  <div class="w-full h-24 bg-gray-800 flex items-center justify-center text-3xl">🍬</div>
                }
                <div class="px-3 pt-2 pb-1">
                  <p class="font-bold text-white text-sm truncate">{{ topping.name }}</p>
                  <p class="text-purple-400 text-xs mt-0.5">{{ formatPrice(topping.unitPrice) }} c/u</p>
                </div>
              </button>
              @if (getToppingQty(topping.id) > 0) {
                <div class="flex items-center justify-between px-3 pb-2">
                  <button (click)="adjustTopping(topping.id, -1)" class="w-7 h-7 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-bold touch-manipulation">−</button>
                  <span class="text-white font-bold text-sm">{{ getToppingQty(topping.id) }}</span>
                  <button (click)="adjustTopping(topping.id, 1)" class="w-7 h-7 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold touch-manipulation">+</button>
                </div>
              }
            </div>
          }
        </div>
      </div>
      <div class="flex gap-3 px-5 py-3 bg-gray-900 border-t border-gray-800">
        <button (click)="backToStep2()" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-xl touch-manipulation">
          ← Sabor
        </button>
        <button (click)="addAnotherItem()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl font-medium touch-manipulation">
          + Agregar otro ítem
        </button>
        <button (click)="proceedToPayment()" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-xl font-semibold touch-manipulation">
          Ir a pagar →
        </button>
      </div>
    }

    <!-- ── STEP 4: CUPÓN ─────────────────────────────── -->
    @if (step === 4) {
      <div class="flex-1 flex flex-col items-center justify-center p-8">
        <div class="w-full max-w-md space-y-5">
          <div>
            <h2 class="text-xl font-bold text-white mb-1">Cupón de descuento</h2>
            <p class="text-gray-400 text-sm">Opcional — puedes continuar sin cupón</p>
          </div>

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
            >
              {{ couponLoading ? '...' : 'Validar' }}
            </button>
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

          <!-- Order summary preview -->
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
      </div>
      <div class="flex gap-3 px-5 py-3 bg-gray-900 border-t border-gray-800">
        <button (click)="step = 3; items.pop(); draftProduct = items.length > 0 ? undefined : draftProduct" class="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2.5 rounded-xl touch-manipulation">
          ← Atrás
        </button>
        <button (click)="step = 5" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-xl font-semibold touch-manipulation">
          Confirmar →
        </button>
      </div>
    }

    <!-- ── STEP 5: CONFIRMAR ──────────────────────────── -->
    @if (step === 5) {
      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <h2 class="text-xl font-bold text-white">Resumen del pedido</h2>

        <!-- Items -->
        @for (item of items; track $index) {
          <div class="bg-gray-900 rounded-xl p-4 space-y-1">
            <div class="flex justify-between">
              <span class="text-white font-medium">{{ item.product.name }} — {{ item.flavor.name }}</span>
              <span class="text-purple-400">{{ formatPrice(item.itemTotal) }}</span>
            </div>
            @for (ts of item.toppings; track ts.topping.id) {
              <div class="flex justify-between text-sm text-gray-400 pl-3">
                <span>{{ ts.topping.name }} × {{ ts.quantity }}</span>
                <span>{{ formatPrice(Number(ts.topping.unitPrice) * ts.quantity) }}</span>
              </div>
            }
          </div>
        }

        <!-- Notes -->
        <div>
          <label class="block text-sm text-gray-400 mb-1">Notas (opcional)</label>
          <textarea
            [(ngModel)]="notes"
            rows="2"
            placeholder="Ej. sin azúcar, para llevar..."
            class="w-full bg-gray-900 text-white rounded-xl px-4 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          ></textarea>
        </div>

        <!-- Price breakdown -->
        <div class="bg-gray-900 rounded-xl p-4 space-y-2 text-sm">
          <div class="flex justify-between text-gray-300">
            <span>Subtotal</span>
            <span>{{ formatPrice(subtotal) }}</span>
          </div>
          @if (couponResult) {
            <div class="flex justify-between text-green-400">
              <span>Descuento ({{ couponResult.code }})</span>
              <span>-{{ formatPrice(discountAmount) }}</span>
            </div>
          }
          <div class="flex justify-between text-white font-bold text-lg border-t border-gray-700 pt-2 mt-1">
            <span>Total</span>
            <span>{{ formatPrice(total) }}</span>
          </div>
        </div>

        @if (submitError) {
          <p class="text-red-400 text-sm">{{ submitError }}</p>
        }
      </div>

      <div class="flex gap-3 px-5 py-3 bg-gray-900 border-t border-gray-800">
        <button (click)="step = 4" class="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2.5 rounded-xl touch-manipulation">
          ← Atrás
        </button>
        <button
          (click)="placeOrder()"
          [disabled]="submitting"
          class="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-lg touch-manipulation"
        >
          {{ submitting ? 'Registrando...' : '✓ Confirmar pedido' }}
        </button>
      </div>
    }

  }<!-- /loading -->
</div>
```

- [ ] **Step 3: Build to verify**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -15
```

Expected: build succeeds. Fix any TypeScript errors before proceeding.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/features/orders/new-order/
git commit -m "feat: replace NewOrder stub with 5-step order flow"
```

---

## Task 5: Angular Order History page

**Files:**
- Modify: `helados-ui/src/app/features/orders/order-history/order-history.component.ts` (replaces stub)
- Create:  `helados-ui/src/app/features/orders/order-history/order-history.component.html`

**Context:** Default filter = today. Date range inputs with "Hoy" quick button. Cards (not table — easier on touch). Tap card to expand full detail. Read-only.

- [ ] **Step 1: Replace stub component**

Replace `helados-ui/src/app/features/orders/order-history/order-history.component.ts`:
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OrderService } from '../../../core/services/order.service';
import { Order } from '../../../core/models/order.model';

@Component({
  selector: 'app-order-history',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './order-history.component.html',
})
export class OrderHistoryComponent implements OnInit {
  private orderSvc = inject(OrderService);

  orders: Order[] = [];
  loading = false;
  expandedId: string | null = null;

  fromDate = '';
  toDate   = '';

  ngOnInit() {
    const today = new Date().toISOString().split('T')[0];
    this.fromDate = today;
    this.toDate   = today;
    this.load();
  }

  load() {
    this.loading = true;
    this.orderSvc.getAll(this.fromDate || undefined, this.toDate || undefined).subscribe({
      next:  (o) => { this.orders = o; this.loading = false; },
      error: ()  => { this.loading = false; },
    });
  }

  setToday() {
    const today = new Date().toISOString().split('T')[0];
    this.fromDate = today;
    this.toDate   = today;
    this.load();
  }

  toggleExpand(id: string) {
    this.expandedId = this.expandedId === id ? null : id;
  }

  formatPrice(n: number | string) { return `$${Number(n).toFixed(2)}`; }

  itemSummary(order: Order): string {
    return order.items.map(i => `${i.product.name} (${i.flavor.name})`).join(', ');
  }
}
```

- [ ] **Step 2: Create template**

Create `helados-ui/src/app/features/orders/order-history/order-history.component.html`:
```html
<div class="min-h-screen bg-gray-950 p-5">

  <!-- Header + filters -->
  <div class="flex flex-wrap items-center gap-3 mb-5">
    <h1 class="text-2xl font-bold text-white">Historial de pedidos</h1>
    <div class="flex items-center gap-2 ml-auto">
      <button (click)="setToday()" class="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded-lg touch-manipulation">
        Hoy
      </button>
      <input
        [(ngModel)]="fromDate"
        type="date"
        class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      <span class="text-gray-400 text-sm">—</span>
      <input
        [(ngModel)]="toDate"
        type="date"
        class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      <button (click)="load()" class="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg font-medium touch-manipulation">
        Buscar
      </button>
    </div>
  </div>

  @if (loading) {
    <p class="text-gray-400">Cargando...</p>
  } @else if (orders.length === 0) {
    <div class="text-center py-16">
      <p class="text-gray-500 text-lg">No hay pedidos en este rango de fechas.</p>
    </div>
  } @else {
    <div class="space-y-3">
      @for (order of orders; track order.id) {
        <div
          class="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden"
        >
          <!-- Collapsed row -->
          <button
            (click)="toggleExpand(order.id)"
            class="w-full text-left px-5 py-4 flex items-center gap-4 touch-manipulation hover:bg-gray-800/50 transition-colors"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3">
                <span class="text-white font-medium text-sm truncate">{{ itemSummary(order) }}</span>
              </div>
              <div class="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                <span>{{ order.staff.name }}</span>
                <span>·</span>
                <span>{{ order.createdAt | date:'HH:mm' }}</span>
                @if (order.coupon) {
                  <span class="text-purple-400">· 🏷 {{ order.coupon.code }}</span>
                }
              </div>
            </div>
            <div class="text-right shrink-0">
              <p class="text-white font-bold">{{ formatPrice(order.totalAmount) }}</p>
              @if (order.discountAmount > 0) {
                <p class="text-green-400 text-xs">-{{ formatPrice(order.discountAmount) }}</p>
              }
            </div>
            <span class="text-gray-500 text-lg">{{ expandedId === order.id ? '▲' : '▼' }}</span>
          </button>

          <!-- Expanded detail -->
          @if (expandedId === order.id) {
            <div class="border-t border-gray-800 px-5 pb-4 pt-3 space-y-3">
              @for (item of order.items; track item.id) {
                <div class="bg-gray-800 rounded-xl p-3 space-y-1 text-sm">
                  <div class="flex justify-between">
                    <span class="text-white font-medium">{{ item.product.name }} — {{ item.flavor.name }}</span>
                    <span class="text-purple-400">{{ formatPrice(item.itemTotal) }}</span>
                  </div>
                  @for (ts of item.toppings; track ts.id) {
                    <div class="flex justify-between text-gray-400 pl-3 text-xs">
                      <span>{{ ts.topping.name }} × {{ ts.quantity }}</span>
                      <span>{{ formatPrice(Number(ts.topping.unitPrice ?? 0) * ts.quantity) }}</span>
                    </div>
                  }
                </div>
              }

              @if (order.notes) {
                <p class="text-gray-400 text-sm italic">📝 {{ order.notes }}</p>
              }

              <!-- Price breakdown -->
              <div class="text-sm space-y-1 pt-1">
                <div class="flex justify-between text-gray-400">
                  <span>Subtotal</span>
                  <span>{{ formatPrice(order.subtotal) }}</span>
                </div>
                @if (order.discountAmount > 0) {
                  <div class="flex justify-between text-green-400">
                    <span>Descuento{{ order.coupon ? ' (' + order.coupon.code + ')' : '' }}</span>
                    <span>-{{ formatPrice(order.discountAmount) }}</span>
                  </div>
                }
                <div class="flex justify-between text-white font-bold border-t border-gray-700 pt-1 mt-1">
                  <span>Total</span>
                  <span>{{ formatPrice(order.totalAmount) }}</span>
                </div>
              </div>

              <p class="text-gray-500 text-xs">{{ order.createdAt | date:'dd/MM/yyyy HH:mm' }} · ID {{ order.id.slice(0,8) }}</p>
            </div>
          }
        </div>
      }
    </div>
  }
</div>
```

- [ ] **Step 3: Build to verify**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/features/orders/order-history/
git commit -m "feat: replace OrderHistory stub with date-filtered order list"
```

---

## Plan 3 Complete

The app now supports:
- **POST /orders** — creates order with atomic price calculation + coupon application
- **GET /orders?from=&to=** — date-filtered order list with full details
- **GET /orders/:id** — single order detail
- **Angular New Order** — 5-step flow: product → flavor → toppings → coupon → confirm, multi-item support, live price calculation
- **Angular Order History** — date-range filter, expandable cards, shows full item breakdown

**Next:** Plan 4 — Inventory snapshots (morning/night), comparison view with delta, and Analytics dashboard.
