# Split Payments Design Spec

**Date:** 2026-06-15
**Status:** Approved for implementation

---

## Goal

Allow staff to split an order's payment across QR and Efectivo (CASH), where one amount is entered manually and the remainder is auto-computed. A single payment method remains the default; split is opt-in.

---

## Section 1: Data Model

### Remove
- `Order.paymentMethod: PaymentMethod` — column dropped entirely.

### Add
New `OrderPayment` model:

```prisma
model OrderPayment {
  id            String        @id @default(uuid())
  orderId       String
  order         Order         @relation(fields: [orderId], references: [id])
  paymentMethod PaymentMethod
  amount        Decimal       @db.Decimal(10, 2)
}
```

`Order` gains:
```prisma
payments OrderPayment[]
```

**Constraints:**
- Every order has **1 or 2** `OrderPayment` rows.
- No two rows on the same order share the same `paymentMethod`.
- Sum of `amount` values equals the order's `totalAmount`.

### Migration
One Prisma migration:
1. Create `OrderPayment` table.
2. Migrate existing `Order` rows: insert one `OrderPayment` row per order using the existing `paymentMethod` and `totalAmount`.
3. Drop `Order.paymentMethod` column.

---

## Section 2: Backend — API & Validation

### DTO changes (`create-order.dto.ts`)

Replace `paymentMethod` field with:

```typescript
class CreateOrderPaymentDto {
  @IsEnum(['QR', 'CASH'])
  method: 'QR' | 'CASH';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

// On CreateOrderDto:
@IsArray()
@ArrayMinSize(1)
@ArrayMaxSize(2)
@ValidateNested({ each: true })
@Type(() => CreateOrderPaymentDto)
payments: CreateOrderPaymentDto[];
```

### Service validation (`orders.service.ts`)

Two validations run after coupon discount is computed, before any DB writes:

1. **Duplicate method check** — if `payments` contains two entries with the same `paymentMethod` → `BadRequestException` (400), message in Spanish.
2. **Sum check** — if `sum(payments[].amount) !== totalAmount` → `UnprocessableEntityException` (422), message in Spanish.

Both use `Math.round(value * 100)` integer comparison to avoid floating-point drift.

### Transaction

Inside the existing Prisma `$transaction`, the `order.create` call includes:

```typescript
payments: {
  create: dto.payments.map(p => ({
    paymentMethod: p.method,
    amount:        p.amount,
  })),
},
```

### Order include (`orderInclude` constant)

Add `payments: true` so every order response includes the payment breakdown.

### Analytics

Unaffected — analytics only aggregates `Order.totalAmount`, which is unchanged.

---

## Section 3: Frontend — Models & Component

### Model changes (`order.model.ts`)

```typescript
export interface OrderPaymentEntry {
  method: PaymentMethod;
  amount: number;
}

// Order: replace paymentMethod with:
payments: OrderPaymentEntry[];

// CreateOrderPayload: replace paymentMethod with:
payments: OrderPaymentEntry[];
```

### New-order component — Step 4 (payment step)

**Three top-level mode buttons:**
- **Solo QR** — full total via QR; builds `payments: [{ method: 'QR', amount: total }]`
- **Solo Efectivo** — full total via CASH; builds `payments: [{ method: 'CASH', amount: total }]`
- **Dividido** — split mode (see below)

**Split mode UI (when Dividido is selected):**
1. Two sub-buttons to pick the **primary method** (QR or Efectivo).
2. Numeric input for that method's partial amount. Constraints: `0.01 ≤ amount < total`.
3. Read-only computed line: "Resto en [other method]: $X.XX" (`total − entered`).
4. "Confirmar →" enabled only when a valid partial amount is entered.

**Component state additions:**
```typescript
paymentMode: 'QR' | 'CASH' | 'SPLIT' | null = null;
splitMethod: PaymentMethod | null = null;   // primary method in split
splitAmount: number | null = null;          // manually entered amount
```

**`placeOrder()` assembles `payments`:**
```typescript
const otherMethod = splitMethod === 'QR' ? 'CASH' : 'QR';
const remainder   = Math.round((total - splitAmount!) * 100) / 100;

payments = paymentMode === 'SPLIT'
  ? [
      { method: splitMethod!, amount: splitAmount! },
      { method: otherMethod,  amount: remainder },
    ]
  : [{ method: paymentMode as PaymentMethod, amount: total }];
```

**`resetOrder()` clears:** `paymentMode`, `splitMethod`, `splitAmount`.

### Order history (`order-history.component.html`)

Replace the single payment method badge with a payment breakdown:
- Single: "QR $10.00" or "Efectivo $10.00"
- Split: "QR $4.00 + Efectivo $6.00"

---

## Section 4: Testing

All tests added to `orders.service.spec.ts` following the existing mock-Prisma pattern.

| # | Test | Expected |
|---|------|----------|
| 1 | Single payment equaling total | Order created, 1 `OrderPayment` row in transaction |
| 2 | Two payments summing to total | Order created, 2 `OrderPayment` rows |
| 3 | Payments don't sum to total | `UnprocessableEntityException` (422) |
| 4 | Duplicate payment methods | `BadRequestException` (400) |
| 5 | `OrderPayment` rows written in transaction | Verifies `payments.create` in `order.create` call |

Angular build check (`npx ng build --configuration=development`) serves as the frontend correctness gate.

---

## Out of Scope

- More than 2 payment methods (only QR and CASH exist).
- Partial payment / layaway (order must be fully paid to be confirmed).
- Payment method breakdown in analytics.
