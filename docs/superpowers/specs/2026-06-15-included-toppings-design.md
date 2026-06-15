# Included Toppings per Product — Design Spec

**Date:** 2026-06-15
**Status:** Approved

## Problem

Certain products (e.g. a Container) include one or more toppings in their base price. Under the current model, every topping is charged at its unit price regardless of the product. This forces a workaround of lowering the base price — which breaks the price when no topping is chosen.

## Goal

Allow each product to declare an optional topping allowance (a type + quantity). Toppings within the allowance are free; toppings beyond it are charged at their normal unit price.

## Constraints

- A product has **at most one allowance type** (NORMAL or PREMIUM — not both).
- Allowance slots are **type-specific**: a PREMIUM topping cannot consume a NORMAL slot.
- Overflow toppings (beyond the included quantity) are charged at full unit price.
- Existing products with no allowance are unaffected.

---

## Section 1: Data Model

Two nullable columns added to the `Product` table:

| Column | Type | Nullable |
|---|---|---|
| `includedToppingType` | `ToppingType` (enum) | Yes |
| `includedToppingQty` | `Int` | Yes |

Both are null for products with no allowance. Both must be set together (co-presence rule enforced at the DTO layer). Existing products default to `NULL` — no data migration required.

A new Prisma migration adds these columns as nullable.

---

## Section 2: Order Calculation

Change lives entirely in `orders.service.ts`, in the per-item cost loop.

**Algorithm per order item:**

```
remainingFree = product.includedToppingQty ?? 0
toppingCost   = 0

for each topping t on the item:
  if t.type === product.includedToppingType AND remainingFree > 0:
    freeQty    = min(t.quantity, remainingFree)
    chargedQty = t.quantity - freeQty
    remainingFree -= freeQty
    toppingCost += chargedQty * t.unitPrice
  else:
    toppingCost += t.quantity * t.unitPrice
```

**Example:** Container (basePrice 7, includes 2 NORMAL), customer picks 3 NORMAL toppings at 1.00 each:
- Topping 1: 1 free (remainingFree → 1)
- Topping 2: 1 free (remainingFree → 0)
- Topping 3: 1.00 charged
- Total = 7 + 1.00 = **8.00**

`unitPriceAtSale` on `OrderItemTopping` is unchanged — it always stores the topping's current unit price regardless of whether a slot was consumed.

Products need `includedToppingType` and `includedToppingQty` included in the `productMap` query. Since `findMany` returns all fields, these appear automatically once the migration runs.

The topping query must return `type` alongside `unitPrice` — it already does (full row fetch).

---

## Section 3: API — DTOs & Validation

**`CreateProductDto`** gains two optional fields:

```typescript
@IsOptional()
@IsEnum(ToppingType)
includedToppingType?: ToppingType;

@IsOptional()
@IsInt()
@Min(1)
@Type(() => Number)
includedToppingQty?: number;
```

A class-level custom validator enforces co-presence: both fields must be set together or both absent. Sending one without the other returns HTTP 400.

**`UpdateProductDto`** extends `PartialType(CreateProductDto)` — inherits the new fields automatically. Same co-presence rule applies. Sending both as `null` clears the allowance.

**`GET /products`** — no controller change needed. The new columns appear in the response automatically.

---

## Section 4: Frontend (Catalog Admin UI)

**Product model** (`helados-ui`) gains:
```typescript
includedToppingType?: 'NORMAL' | 'PREMIUM';
includedToppingQty?: number;
```

**Catalog form** (`catalog.component.ts` / `.html`) gains:
- A **select** "Topping incluido": options None / Normal / Premium
- A **number input** "Cantidad" — visible and required only when a topping type is selected; hidden when None

When submitting:
- Type = None → both fields sent as `null`
- Type selected → both fields sent together

No changes required in the order flow UI — pricing is computed server-side.

---

## Section 5: Testing

All tests use the existing Jest + mocked Prisma pattern.

**`orders.service.spec.ts`** — three new cases:
1. Toppings within allowance are free (2 NORMAL included, 2 NORMAL selected → no topping cost added)
2. Overflow toppings are charged (2 NORMAL included, 3 NORMAL selected → 1 charged)
3. Non-included type is always charged (2 NORMAL included, 1 PREMIUM selected → PREMIUM charged in full)

**`products.service.spec.ts`** — two new cases:
1. Creating a product with a valid allowance (both fields set) persists correctly
2. Creating a product with no allowance (both null) persists correctly
