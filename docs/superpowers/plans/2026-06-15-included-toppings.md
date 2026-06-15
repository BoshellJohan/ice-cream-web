# Included Toppings per Product — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each product to declare an optional topping allowance (type + quantity); toppings within that allowance are free when the order is calculated.

**Architecture:** Two nullable columns (`includedToppingType`, `includedToppingQty`) are added to the `Product` table. The per-item cost loop in `OrdersService.create` applies the allowance before summing the subtotal. DTOs enforce co-presence validation. The Angular catalog form gains a conditional type select + quantity input for admins.

**Tech Stack:** NestJS 11, Prisma 5, PostgreSQL, class-validator, Angular 18 (standalone), Tailwind CSS.

---

## Files Touched

| Action | Path | Purpose |
|---|---|---|
| Modify | `helados-api/prisma/schema.prisma` | Add two nullable columns to `Product` |
| Create | `helados-api/prisma/migrations/<ts>_add_product_topping_allowance/` | DB migration |
| Modify | `helados-api/src/products/dto/create-product.dto.ts` | New fields + co-presence validator |
| Modify | `helados-api/src/products/dto/update-product.dto.ts` | Same fields, nullable for clearing |
| Modify | `helados-api/src/products/products.service.spec.ts` | 2 new tests verifying field pass-through |
| Modify | `helados-api/src/orders/orders.service.ts` | Allowance logic in toppingCost loop |
| Modify | `helados-api/src/orders/orders.service.spec.ts` | 3 new allowance calculation tests |
| Modify | `helados-ui/src/app/core/models/product.model.ts` | Add new fields to `Product` + `CreateProductPayload` |
| Modify | `helados-ui/src/app/features/catalog/catalog.component.ts` | `form` object, `openCreate`, `openEdit`, `save` |
| Modify | `helados-ui/src/app/features/catalog/catalog.component.html` | Type select, qty input, card badge |

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `helados-api/prisma/schema.prisma`

- [ ] **Step 1: Add two nullable columns to the Product model in schema.prisma**

In `helados-api/prisma/schema.prisma`, update the `Product` model:

```prisma
model Product {
  id                  String          @id @default(uuid())
  name                String
  type                ProductType
  size                ProductSize
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
```

- [ ] **Step 2: Create and apply the migration**

```bash
cd helados-api && npx prisma migrate dev --name add_product_topping_allowance
```

Expected output: migration created and applied, no errors.

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` in output.

- [ ] **Step 4: Commit**

```bash
git add helados-api/prisma/schema.prisma helados-api/prisma/migrations/
git commit -m "feat: add includedToppingType and includedToppingQty columns to Product"
```

---

### Task 2: Orders Service — Write Failing Tests (RED)

**Files:**
- Modify: `helados-api/src/orders/orders.service.spec.ts`

- [ ] **Step 1: Add `type` field to the existing topping fixtures**

In `helados-api/src/orders/orders.service.spec.ts`, update `topping1` and `topping2` (line ~21):

```typescript
const topping1 = { id: 't1', name: 'Oreo',      unitPrice: 0.5, active: true, type: 'NORMAL' };
const topping2 = { id: 't2', name: 'Sprinkles',  unitPrice: 1,   active: true, type: 'NORMAL' };
```

- [ ] **Step 2: Add a PREMIUM topping fixture and a product-with-allowance fixture**

After `topping2`, add:

```typescript
const topping3 = { id: 't3', name: 'Caramel',   unitPrice: 2,   active: true, type: 'PREMIUM' };
const productWithAllowance = {
  id: 'p2', name: 'Container', basePrice: 7, active: true, directSale: false,
  includedToppingType: 'NORMAL', includedToppingQty: 2,
};
```

- [ ] **Step 3: Write three new test cases inside `describe('create', () => {`**

Add after the existing `it('does not call coupon.update when no coupon used', ...)` test:

```typescript
it('toppings within NORMAL allowance are free', async () => {
  mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
  mockPrisma.flavor.findMany.mockResolvedValue([]);
  mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.order.create.mockResolvedValue(fakeOrder);

  await service.create('staff1', {
    paymentMethod: 'QR',
    items: [{ productId: 'p2', toppings: [{ toppingId: 't1', quantity: 1 }, { toppingId: 't2', quantity: 1 }] }],
  });

  // basePrice=7, 2 NORMAL included, 2 NORMAL selected → toppingCost=0 → subtotal=7
  expect(mockPrisma.order.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ subtotal: 7, totalAmount: 7 }) }),
  );
});

it('toppings beyond NORMAL allowance are charged', async () => {
  mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
  mockPrisma.flavor.findMany.mockResolvedValue([]);
  mockPrisma.topping.findMany.mockResolvedValue([topping1, topping2]);
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.order.create.mockResolvedValue(fakeOrder);

  await service.create('staff1', {
    paymentMethod: 'QR',
    items: [{ productId: 'p2', toppings: [{ toppingId: 't1', quantity: 2 }, { toppingId: 't2', quantity: 1 }] }],
  });

  // t1 qty=2: consumes 2 free slots (remainingFree → 0); t2 qty=1: charged 1×1.00=1.00
  // subtotal = 7 + 1 = 8
  expect(mockPrisma.order.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ subtotal: 8, totalAmount: 8 }) }),
  );
});

it('PREMIUM toppings are charged when product includes NORMAL', async () => {
  mockPrisma.product.findMany.mockResolvedValue([productWithAllowance]);
  mockPrisma.flavor.findMany.mockResolvedValue([]);
  mockPrisma.topping.findMany.mockResolvedValue([topping3]);
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.order.create.mockResolvedValue(fakeOrder);

  await service.create('staff1', {
    paymentMethod: 'QR',
    items: [{ productId: 'p2', toppings: [{ toppingId: 't3', quantity: 1 }] }],
  });

  // PREMIUM does not consume NORMAL allowance → charged 1×2.00=2.00 → subtotal=9
  expect(mockPrisma.order.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ subtotal: 9, totalAmount: 9 }) }),
  );
});
```

- [ ] **Step 4: Run and verify the 3 new tests FAIL**

```bash
cd helados-api && npx jest src/orders/orders.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: 3 new tests fail. Test 1 fails because all toppings are currently charged (subtotal 8.5, not 7). Tests 2 and 3 may coincidentally match the current output — that's acceptable since test 1 is the canonical RED signal.

---

### Task 3: Orders Service — Implement Allowance Calculation (GREEN)

**Files:**
- Modify: `helados-api/src/orders/orders.service.ts`

- [ ] **Step 1: Replace the toppingCost calculation in the per-item loop**

In `helados-api/src/orders/orders.service.ts`, locate the per-item loop (around line 76). Replace:

```typescript
const itemTotal   = Number(product.basePrice) + (flavor ? Number(flavor.priceModifier) : 0);
const toppingCost = item.toppings.reduce((sum, t) => {
  return sum + Number(toppingMap.get(t.toppingId)!.unitPrice) * t.quantity;
}, 0);
itemTotals.push(itemTotal);
subtotal += itemTotal + toppingCost;
```

With:

```typescript
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
```

- [ ] **Step 2: Run the orders service tests**

```bash
cd helados-api && npx jest src/orders/orders.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: all 15 tests pass (12 original + 3 new).

- [ ] **Step 3: Run the full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add helados-api/src/orders/orders.service.ts helados-api/src/orders/orders.service.spec.ts
git commit -m "feat: apply per-product topping allowance in order cost calculation"
```

---

### Task 4: Backend DTOs + Products Service Tests

**Files:**
- Modify: `helados-api/src/products/dto/create-product.dto.ts`
- Modify: `helados-api/src/products/dto/update-product.dto.ts`
- Modify: `helados-api/src/products/products.service.spec.ts`

- [ ] **Step 1: Write two failing product service tests (RED)**

In `helados-api/src/products/products.service.spec.ts`, add inside `describe('ProductsService', () => {`:

```typescript
it('creates product with included topping allowance', async () => {
  const dto = {
    name: 'Container', type: 'CONTAINER' as const, size: 'MEDIUM' as const,
    basePrice: 7, includedToppingType: 'NORMAL' as const, includedToppingQty: 2,
  };
  mockPrisma.product.create.mockResolvedValue({
    id: 'p2', ...dto, active: true, directSale: false, imageUrl: null, createdAt: new Date(),
  });
  await service.create(dto);
  expect(mockPrisma.product.create).toHaveBeenCalledWith({ data: dto });
});

it('creates product with no topping allowance', async () => {
  const dto = { name: 'Small Cone', type: 'CONE' as const, size: 'SMALL' as const, basePrice: 2.5 };
  mockPrisma.product.create.mockResolvedValue({
    id: 'p3', ...dto, active: true, directSale: false, imageUrl: null,
    includedToppingType: null, includedToppingQty: null, createdAt: new Date(),
  });
  await service.create(dto);
  expect(mockPrisma.product.create).toHaveBeenCalledWith({ data: dto });
});
```

- [ ] **Step 2: Run and verify the new tests FAIL (TypeScript compile error)**

```bash
cd helados-api && npx jest src/products/products.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: TypeScript error — `includedToppingType` and `includedToppingQty` are not in `CreateProductDto`.

- [ ] **Step 3: Replace `create-product.dto.ts`**

Full content of `helados-api/src/products/dto/create-product.dto.ts`:

```typescript
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL', 'DRINK'])
  type: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL' | 'DRINK';

  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size: 'SMALL' | 'MEDIUM' | 'LARGE';

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

  // Both must be set together or both absent.
  // @ValidateIf triggers when the *other* field is non-null, enforcing co-presence.
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

- [ ] **Step 4: Replace `update-product.dto.ts`**

Full content of `helados-api/src/products/dto/update-product.dto.ts`:

```typescript
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL', 'DRINK'])
  type?: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL' | 'DRINK';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';

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

  // Both null → clears the allowance. One set without the other → 400.
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

- [ ] **Step 5: Run products service tests (GREEN)**

```bash
cd helados-api && npx jest src/products/products.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: all 6 tests pass (4 existing + 2 new).

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add helados-api/src/products/dto/create-product.dto.ts helados-api/src/products/dto/update-product.dto.ts helados-api/src/products/products.service.spec.ts
git commit -m "feat: add includedToppingType and includedToppingQty to product DTOs with co-presence validation"
```

---

### Task 5: Angular — Model, Form, and Build Check

**Files:**
- Modify: `helados-ui/src/app/core/models/product.model.ts`
- Modify: `helados-ui/src/app/features/catalog/catalog.component.ts`
- Modify: `helados-ui/src/app/features/catalog/catalog.component.html`

- [ ] **Step 1: Update the Product model**

Replace the full content of `helados-ui/src/app/core/models/product.model.ts`:

```typescript
import { ToppingType } from './topping.model';

export type ProductType = 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL' | 'DRINK';
export type ProductSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  size: ProductSize;
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
  size: ProductSize;
  basePrice: number;
  imageUrl?: string;
  directSale?: boolean;
  includedToppingType?: ToppingType | null;
  includedToppingQty?: number | null;
}
```

- [ ] **Step 2: Update catalog.component.ts — `form` object**

In `helados-ui/src/app/features/catalog/catalog.component.ts`, replace the `form` property (currently lines 39–50):

```typescript
form = {
  name: '',
  basePrice: 0,
  priceModifier: 0,
  toppingType: 'NORMAL' as ToppingType,
  useCustomPrice: false,
  customPrice: 0,
  type: 'CONE' as ProductType,
  size: 'SMALL' as ProductSize,
  imageUrl: '',
  directSale: false,
  includedToppingType: null as ToppingType | null,
  includedToppingQty: null as number | null,
};
```

- [ ] **Step 3: Update `openCreate()` to reset the new fields**

Replace `openCreate()`:

```typescript
openCreate() {
  this.editingId = null;
  this.form = {
    name: '', basePrice: 0, priceModifier: 0, toppingType: 'NORMAL',
    useCustomPrice: false, customPrice: 0, type: 'CONE', size: 'SMALL',
    imageUrl: '', directSale: false,
    includedToppingType: null, includedToppingQty: null,
  };
  this.error = '';
  this.showForm = true;
}
```

- [ ] **Step 4: Update `openEdit()` to populate the new fields**

Replace `openEdit()`:

```typescript
openEdit(item: CatalogItem) {
  this.editingId = item.id;
  const topping = item as Topping;
  this.form = {
    name: item.name,
    basePrice: Number((item as Product).basePrice ?? 0),
    priceModifier: Number((item as Flavor).priceModifier ?? 0),
    toppingType: topping.type ?? 'NORMAL',
    useCustomPrice: topping.customPrice != null,
    customPrice: Number(topping.customPrice ?? 0),
    type: (item as Product).type ?? 'CONE',
    size: (item as Product).size ?? 'SMALL',
    imageUrl: item.imageUrl ?? '',
    directSale: (item as Product).directSale ?? false,
    includedToppingType: (item as Product).includedToppingType ?? null,
    includedToppingQty: (item as Product).includedToppingQty ?? null,
  };
  this.error = '';
  this.showForm = true;
}
```

- [ ] **Step 5: Update the product create/update calls in `save()`**

In `save()`, replace the product branch (the `activeTab === 'products'` ternary):

```typescript
const obs: Observable<unknown> = this.activeTab === 'products'
  ? (this.editingId
      ? this.productSvc.update(this.editingId, {
          name: this.form.name, type: this.form.type, size: this.form.size,
          basePrice: this.form.basePrice, imageUrl: this.form.imageUrl || undefined,
          directSale: this.form.directSale,
          includedToppingType: this.form.includedToppingType,
          includedToppingQty: this.form.includedToppingType ? this.form.includedToppingQty : null,
        })
      : this.productSvc.create({
          name: this.form.name, type: this.form.type, size: this.form.size,
          basePrice: this.form.basePrice, imageUrl: this.form.imageUrl || undefined,
          directSale: this.form.directSale,
          includedToppingType: this.form.includedToppingType ?? undefined,
          includedToppingQty: this.form.includedToppingType ? (this.form.includedToppingQty ?? undefined) : undefined,
        }))
  : this.activeTab === 'flavors'
    ? (this.editingId
        ? this.flavorSvc.update(this.editingId, { name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined })
        : this.flavorSvc.create({ name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined }))
    : (this.editingId
        ? this.toppingSvc.update(this.editingId, {
            name: this.form.name,
            type: this.form.toppingType,
            customPrice: this.form.useCustomPrice ? this.form.customPrice : null,
            imageUrl: this.form.imageUrl || undefined,
          })
        : this.toppingSvc.create({
            name: this.form.name,
            type: this.form.toppingType,
            customPrice: this.form.useCustomPrice ? this.form.customPrice : null,
            imageUrl: this.form.imageUrl || undefined,
          }));
```

- [ ] **Step 6: Update catalog.component.html — add allowance fields to the product form**

Inside `@if (activeTab === 'products')`, after the closing `</label>` of the directSale toggle (around line 158), add:

```html
<!-- Included topping allowance -->
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
```

- [ ] **Step 7: Add a badge to the product card for products with an allowance**

In the card grid's badge block (`<div class="flex flex-wrap gap-1 mt-1">`), after the `customPrice` badge (around line 87), add:

```html
@if ($any(item).includedToppingType) {
  <span class="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">
    +{{ $any(item).includedToppingQty }} {{ $any(item).includedToppingType === 'NORMAL' ? 'Normal' : 'Premium' }}
  </span>
}
```

- [ ] **Step 8: Run Angular build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -10
```

Expected: build completes with no errors and no warnings.

- [ ] **Step 9: Commit**

```bash
git add helados-ui/src/app/core/models/product.model.ts helados-ui/src/app/features/catalog/catalog.component.ts helados-ui/src/app/features/catalog/catalog.component.html
git commit -m "feat: add included topping allowance fields to catalog product form"
```
