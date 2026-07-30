# Order Cancellation (Soft Void) Design Spec

**Date:** 2026-07-30
**Status:** Approved for implementation

---

## Goal

Let staff void a mis-rung order and keep every downstream figure correct.

Today `POST /orders` is irreversible: `OrdersController` exposes only `POST`, `GET`, and `GET /:id`, and `Order` has no status concept. A wrong size, a wrong flavor, or a double-tap is permanent. Because every analytics query counts every order unconditionally, one bad order permanently inflates revenue and order count, skews top items, and — most damaging — makes **cash reconciliation** report a drawer shortfall that nobody can explain. The reconciliation feature is only trustworthy if voided sales can leave the totals.

Cancellation is a **soft void**: the row is never deleted, so there is always an audit trail of what was voided, by whom, and why.

---

## Section 1: Data Model

```prisma
enum CancelReason {
  REGISTRO_ERRONEO      // "Error al registrar"
  CLIENTE_CANCELO       // "Cliente canceló"
  PRODUCTO_DEFECTUOSO   // "Producto en mal estado"
  OTRO                  // "Otro"
}

model Order {
  // ...existing fields
  cancelledAt     DateTime?
  cancelledBy     String?
  cancelledByUser User?         @relation("OrderCancelledBy", fields: [cancelledBy], references: [id])
  cancelReason    CancelReason?
}
```

`cancelledAt IS NULL` is the single source of truth for "active". There is deliberately **no** `status` enum: with only two states it would duplicate `cancelledAt` and introduce a way for the two to disagree.

The three fields are always set together or all null.

### Required change to `User`

`Order` already has an FK to `User` via `staffId`. Prisma requires explicit relation names once a model has two FKs to the same target, so `User` must also change:

```prisma
model User {
  orders          Order[] @relation("OrderStaff")        // renamed
  cancelledOrders Order[] @relation("OrderCancelledBy")  // new
}
```

The matching `@relation("OrderStaff")` goes on `Order.staff`. This is a schema-level rename only — no column is renamed and no data is migrated.

Migration: `npx prisma migrate dev --name add_order_cancellation`.

No index on `cancelledAt`. At this data volume the existing `createdAt` range scan dominates; adding one now is premature.

---

## Section 2: Cancellation Rules

| Actor | Scope | Time limit |
|---|---|---|
| `ADMIN` | Any order | None |
| `STAFF` | Only orders they registered (`order.staffId === user.sub`) | 15 minutes from `createdAt` |

The 15-minute window covers the error caught while the customer is still at the counter, without letting a real sale quietly disappear from an already-reconciled day.

The window lives in one exported constant:

```typescript
export const CANCEL_WINDOW_MS = 15 * 60 * 1000;
```

A reason is **always required**, chosen from the four `CancelReason` values. Free text was rejected: typing on a tablet mid-service produces useless entries like "error".

---

## Section 3: API

### `PATCH /orders/:id/cancel`

Body:

```typescript
{ reason: CancelReason }
```

Guarded by the existing class-level `@UseGuards(JwtAuthGuard)`. It deliberately does **not** use `RolesGuard`: STAFF access is conditional on ownership and age, which a role check cannot express.

Service logic, in order:

1. Load the order. Missing → `404 NotFoundException` — `"Pedido no encontrado"`.
2. Already cancelled → `409 ConflictException` — `"El pedido ya está anulado"`. This makes a double-tap safe and explicit rather than silently re-stamping the audit fields.
3. Authorize:
   - `ADMIN` → allowed.
   - `STAFF`, owns the order, age ≤ `CANCEL_WINDOW_MS` → allowed.
   - Not the owner → `422` — `"Solo puedes anular pedidos que registraste tú"`.
   - Owner but expired → `422` — `"El plazo de 15 minutos para anular este pedido ya venció. Pide a un administrador que lo anule."`
4. In a single `prisma.$transaction`:
   - Set `cancelledAt = now`, `cancelledBy = user.sub`, `cancelReason = dto.reason`.
   - If `order.couponId` is set, decrement `coupon.usesCount`, floored at 0 (a coupon edited between sale and cancellation must not go negative).
5. Return the updated order using the existing `orderInclude`.

### Why 422 and not 403 for refusals

`auth.interceptor.ts` redirects to `/orders/new` on **any** 403. A 403 here would yank staff off the history page mid-action with no explanation. `422` is already this codebase's idiom for business-rule violations (coupon validation uses it), and it lets the component surface the message inline. `403` stays reserved for "wrong role", which `RolesGuard` raises globally.

### `canCancel` on order reads

`GET /orders` and `GET /orders/:id` return an extra computed field per order:

```typescript
canCancel: boolean   // evaluated server-side for the requesting user
```

The rule is evaluated once, on the server, for the JWT's user. The frontend only shows or hides the button.

This is deliberate. The topping-allowance rule is already mirrored between `orders.service.ts` and `new-order.component.ts` and has to be kept in sync by hand. Duplicating the 15-minute window would be worse, because the tablet clock and the server clock can disagree — staff would see an enabled button that then 422s. With `canCancel` there is one rule in one place.

`canCancel` can go stale while the page sits open. That is accepted: the `PATCH` re-validates and returns a clear message, so the worst case is a good error rather than a wrong number.

---

## Section 4: Excluding Cancelled Orders From Reads

Two exported constants in `src/orders/order-filters.ts` keep the filter shape in one place:

```typescript
export const ACTIVE_ORDER = { cancelledAt: null };
export const ACTIVE_ORDER_RELATION = { order: { cancelledAt: null } };
```

Ten query sites read orders. Eight must exclude cancelled ones:

| File / line | Query | Filter |
|---|---|---|
| `analytics.service.ts:17` | `order.findMany` (summary) | `ACTIVE_ORDER` |
| `analytics.service.ts:53` | `orderItem.groupBy` (top items) | `ACTIVE_ORDER_RELATION` |
| `analytics.service.ts:60` | `orderItemTopping.groupBy` (top items) | `ACTIVE_ORDER_RELATION` |
| `analytics.service.ts:99` | `order.count` (daily) | `ACTIVE_ORDER` |
| `analytics.service.ts:100` | `orderItem.count` (daily) | `ACTIVE_ORDER_RELATION` |
| `analytics.service.ts:101` | `orderPayment.groupBy` (daily) | `ACTIVE_ORDER_RELATION` |
| `analytics.service.ts:144` | `orderPayment.findMany` (reconciliation) | `ACTIVE_ORDER_RELATION` |
| `inventory.service.ts:139` | `orderItem.groupBy` (beverage overlay) | `ACTIVE_ORDER_RELATION` |

Two sites deliberately stay **unfiltered**:

| File / line | Why |
|---|---|
| `orders.service.ts:180` `order.findMany` | History must show cancelled orders |
| `orders.service.ts:188` `order.findUnique` | Detail view must load a cancelled order |

A Prisma client extension for global filtering was considered and rejected: six of the eight sites reach orders through a *relation* (`where: { order: {...} }`), which a model-level extension on `order` never intercepts. It would give false confidence on exactly the feature that most needs to be correct.

---

## Section 5: Frontend

### Model and service

`order.model.ts` gains:

```typescript
cancelledAt: string | null;
cancelledByUser: { name: string } | null;
cancelReason: CancelReason | null;
canCancel: boolean;
```

`OrderService` gains `cancel(id: string, reason: CancelReason)` calling the PATCH.

A `CANCEL_REASON_LABELS` map renders the enum in Spanish for display.

### Order history

- **Cancelled rows** render dimmed, with the total struck through, a red `ANULADO` badge, and a line showing the reason and who cancelled it. They stay in the list for everyone — visible proof the void worked, and an audit trail for the admin.
- **Cancel button** appears on a row only when `order.canCancel` is true.
- **Confirmation step** presents the four reasons as large touch targets sized for a tablet. No free-text field.
- **On success** the list reloads.
- **On error** the 422/409 message is shown inline on the row. Cancellation errors must never navigate away.

No aggregate total exists on the history page, so nothing there needs re-summing.

---

## Section 6: Testing

**`orders.service.spec.ts`**
- ADMIN cancels any order, including one older than the window.
- STAFF cancels their own order inside the window.
- STAFF cancelling their own order past the window → 422.
- STAFF cancelling another user's order → 422.
- Cancelling an already-cancelled order → 409.
- Cancelling a nonexistent order → 404.
- Coupon `usesCount` is decremented when the cancelled order used one.
- `usesCount` never goes below 0.
- `canCancel` is computed correctly for ADMIN, owner-in-window, owner-expired, and non-owner.

**`analytics.service.spec.ts`** — one test per endpoint (`getSummary`, `getTopItems`, `getDaily`, `getReconciliationSummary`) asserting a cancelled order does not move the figure. This is the regression guard for the entire purpose of the feature.

**`inventory.service.spec.ts`** — the beverage overlay ignores cancelled orders.

Frontend is validated with `npx ng build --configuration=development`, per existing project practice.

---

## Out of Scope

- Editing an order after creation (cancel and re-ring instead).
- Partial refunds or per-item voids.
- Restocking inventory on cancellation — inventory is snapshot-based, not perpetual, so a cancelled order simply stops being subtracted by the beverage overlay.
- Rate limiting on login (a separate, unrelated security gap already identified).
