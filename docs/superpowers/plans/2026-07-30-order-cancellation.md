# Order Cancellation (Soft Void) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff void a mis-rung order so it stops counting toward revenue, top items, and cash reconciliation, while leaving a permanent audit trail.

**Architecture:** Soft void — `Order` gains `cancelledAt` / `cancelledBy` / `cancelReason` and rows are never deleted. `cancelledAt IS NULL` is the single source of truth for "active". Eight of the ten order read sites filter cancelled orders out; the two in `orders.service.ts` deliberately do not, so history can still display them. The backend computes a `canCancel` flag per order so the 15-minute rule lives in exactly one place.

**Tech Stack:** NestJS 11, Prisma 5, PostgreSQL, Jest, Angular 18 standalone + Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-30-order-cancellation-design.md`

## Global Constraints

- All user-facing API messages are in **Spanish**, matching existing services.
- **Permission** refusals on cancel use **422** (`UnprocessableEntityException`), never 403 — `auth.interceptor.ts` redirects to `/orders/new` on any 403. This covers the two authorization cases only; a missing order is still **404** and an already-cancelled order is still **409**, as specified in Task 5.
- The cancellation permission rule is defined in **exactly one** private helper and consumed by both `cancel()` and `computeCanCancel()`. Do not restate the role/ownership/window conditions in two places.
- Money stays `Decimal(10,2)`; wrap in `Number(...)` before arithmetic.
- `PrismaModule` is `@Global()` — never import it in a feature module.
- The cancellation window is **15 minutes**, defined once as `CANCEL_WINDOW_MS`.
- The four cancel reasons are exactly: `REGISTRO_ERRONEO`, `CLIENTE_CANCELO`, `PRODUCTO_DEFECTUOSO`, `OTRO`.
- Angular uses `inject()` DI, standalone components, and `@if` / `@for` control flow.
- Run API tests from `helados-api/`; verify the UI with `npx ng build --configuration=development` from `helados-ui/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `helados-api/prisma/schema.prisma` | Modify — `CancelReason` enum, `Order` audit fields, named `User` relations |
| `helados-api/src/orders/order-filters.ts` | Create — the two helpers that express "active order" for queries |
| `helados-api/src/orders/dto/cancel-order.dto.ts` | Create — `CancelOrderDto`, `CANCEL_REASONS`, `CancelReason` |
| `helados-api/src/orders/orders.service.ts` | Modify — `cancel()`, `canCancel()`, thread user through reads |
| `helados-api/src/orders/orders.controller.ts` | Modify — `PATCH /orders/:id/cancel`, pass user to reads |
| `helados-api/src/analytics/analytics.service.ts` | Modify — filter 7 query sites |
| `helados-api/src/inventory/inventory.service.ts` | Modify — filter the beverage-overlay query |
| `helados-ui/src/app/core/models/order.model.ts` | Modify — cancellation fields, `CancelReason`, labels |
| `helados-ui/src/app/core/services/order.service.ts` | Modify — `cancel()` |
| `helados-ui/src/app/features/orders/order-history/order-history.component.ts` | Modify — cancel flow state |
| `helados-ui/src/app/features/orders/order-history/order-history.component.html` | Modify — cancelled styling + cancel UI |

**Note on a deliberate deviation from the spec:** the spec described two plain constants (`ACTIVE_ORDER`, `ACTIVE_ORDER_RELATION`). Spreading a `{ order: {...} }` constant into a `where` that already has an `order` key silently *overwrites* the existing relation filter and drops the date range. This plan uses small helper functions instead, which merge correctly. Same intent, no footgun.

---

## Task 1: Schema and migration

**Files:**
- Modify: `helados-api/prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing
- Produces: `CancelReason` Prisma enum; `Order.cancelledAt: DateTime?`, `Order.cancelledBy: String?`, `Order.cancelReason: CancelReason?`

- [ ] **Step 1: Add the `CancelReason` enum**

In `schema.prisma`, next to the other enums:

```prisma
enum CancelReason {
  REGISTRO_ERRONEO
  CLIENTE_CANCELO
  PRODUCTO_DEFECTUOSO
  OTRO
}
```

- [ ] **Step 2: Add the audit fields and name the `Order.staff` relation**

`Order` already has one FK to `User`. Adding a second requires *both* to be named, so `staff` gets an explicit relation name:

```prisma
model Order {
  id             String         @id @default(uuid())
  staffId        String
  staff          User           @relation("OrderStaff", fields: [staffId], references: [id])
  couponId       String?
  coupon         Coupon?        @relation(fields: [couponId], references: [id])
  createdAt      DateTime       @default(now())
  payments       OrderPayment[]
  subtotal       Decimal        @db.Decimal(10, 2)
  discountAmount Decimal        @db.Decimal(10, 2) @default(0)
  totalAmount    Decimal        @db.Decimal(10, 2)
  notes          String?
  items          OrderItem[]

  cancelledAt     DateTime?
  cancelledBy     String?
  cancelledByUser User?         @relation("OrderCancelledBy", fields: [cancelledBy], references: [id])
  cancelReason    CancelReason?
}
```

- [ ] **Step 3: Update the `User` back-relations**

In `model User`, replace the `orders` line and add the new one:

```prisma
  orders          Order[]               @relation("OrderStaff")
  cancelledOrders Order[]               @relation("OrderCancelledBy")
```

Leave every other `User` field untouched.

- [ ] **Step 4: Generate the migration**

Run from `helados-api/`:

```bash
npx prisma migrate dev --name add_order_cancellation
```

Expected: a new folder under `prisma/migrations/`, and the SQL should contain `ALTER TABLE "Order" ADD COLUMN "cancelledAt"` and `CREATE TYPE "CancelReason"`. It must **not** contain any `DROP TABLE` or `DROP COLUMN` — the relation naming is metadata-only. If you see a destructive statement, stop and re-read Steps 2–3.

- [ ] **Step 5: Verify nothing regressed**

```bash
npm test
```

Expected: 13 suites, 91 tests, all passing.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(orders): añadir campos de anulación al modelo Order"
```

---

## Task 2: The active-order filter helpers

**Files:**
- Create: `helados-api/src/orders/order-filters.ts`
- Test: `helados-api/src/orders/order-filters.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `activeOrder(where?: Record<string, unknown>): Record<string, unknown>` — merges `cancelledAt: null` into a `where` targeting `Order` directly
  - `activeOrderRelation(orderWhere?: Record<string, unknown>): { order: Record<string, unknown> }` — for queries reaching orders through the `order` relation

- [ ] **Step 1: Write the failing test**

Create `helados-api/src/orders/order-filters.spec.ts`:

```typescript
import { activeOrder, activeOrderRelation } from './order-filters';

describe('order filters', () => {
  it('adds cancelledAt: null to a direct where clause', () => {
    const range = { gte: new Date('2026-06-13'), lte: new Date('2026-06-14') };
    expect(activeOrder({ createdAt: range })).toEqual({
      createdAt: range,
      cancelledAt: null,
    });
  });

  it('works with no arguments', () => {
    expect(activeOrder()).toEqual({ cancelledAt: null });
  });

  it('preserves the existing relation filter instead of overwriting it', () => {
    const range = { gte: new Date('2026-06-13'), lte: new Date('2026-06-14') };
    expect(activeOrderRelation({ createdAt: range })).toEqual({
      order: { createdAt: range, cancelledAt: null },
    });
  });

  it('works with no arguments on the relation form', () => {
    expect(activeOrderRelation()).toEqual({ order: { cancelledAt: null } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- order-filters.spec.ts
```

Expected: FAIL — `Cannot find module './order-filters'`.

- [ ] **Step 3: Write the implementation**

Create `helados-api/src/orders/order-filters.ts`:

```typescript
/**
 * Un pedido "activo" es el que no ha sido anulado.
 * Estos helpers existen para que la condición viva en un solo lugar:
 * si se olvida en una consulta, los pedidos anulados vuelven a contar
 * en las analíticas y en la conciliación de caja.
 */

/** Para consultas sobre Order directamente. */
export function activeOrder(where: Record<string, unknown> = {}) {
  return { ...where, cancelledAt: null };
}

/** Para consultas que llegan a Order a través de la relación `order`. */
export function activeOrderRelation(orderWhere: Record<string, unknown> = {}) {
  return { order: { ...orderWhere, cancelledAt: null } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- order-filters.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/orders/order-filters.ts src/orders/order-filters.spec.ts
git commit -m "feat(orders): helpers para filtrar pedidos anulados"
```

---

## Task 3: Exclude cancelled orders from analytics

**Files:**
- Modify: `helados-api/src/analytics/analytics.service.ts` (lines 17, 53, 60, 99, 100, 101, 144)
- Test: `helados-api/src/analytics/analytics.service.spec.ts`

**Interfaces:**
- Consumes: `activeOrder`, `activeOrderRelation` from Task 2
- Produces: nothing new

- [ ] **Step 1: Write the failing tests**

Append to `analytics.service.spec.ts`, inside the top-level `describe('AnalyticsService', ...)`:

```typescript
  describe('excludes cancelled orders', () => {
    it('getSummary filters cancelled orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.getSummary('2026-06-13', '2026-06-14');

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cancelledAt: null }),
        }),
      );
    });

    it('getTopItems filters cancelled orders on both groupings', async () => {
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);
      mockPrisma.orderItemTopping.groupBy.mockResolvedValue([]);
      mockPrisma.flavor.findMany.mockResolvedValue([]);
      mockPrisma.topping.findMany.mockResolvedValue([]);

      await service.getTopItems('2026-06-13', '2026-06-14');

      expect(mockPrisma.orderItem.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ cancelledAt: null }),
          }),
        }),
      );
      expect(mockPrisma.orderItemTopping.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ cancelledAt: null }),
          }),
        }),
      );
    });

    it('getDaily filters cancelled orders on all three queries', async () => {
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.orderItem.count.mockResolvedValue(0);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([]);

      await service.getDaily('2026-06-13');

      expect(mockPrisma.order.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cancelledAt: null }),
        }),
      );
      expect(mockPrisma.orderItem.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ cancelledAt: null }),
          }),
        }),
      );
      expect(mockPrisma.orderPayment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ cancelledAt: null }),
          }),
        }),
      );
    });

    it('getReconciliationSummary filters cancelled orders out of the system totals', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([]);

      await service.getReconciliationSummary('2026-06-13', '2026-06-14');

      expect(mockPrisma.orderPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ cancelledAt: null }),
          }),
        }),
      );
    });
  });
```

These assert the query *shape* because Prisma is mocked — that is the honest assertion at this layer, and it is exactly the thing that breaks if someone forgets a site.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- analytics.service.spec.ts
```

Expected: FAIL — 4 failures, each reporting the received `where` had no `cancelledAt`.

- [ ] **Step 3: Import the helpers**

At the top of `analytics.service.ts`, after the existing imports:

```typescript
import { activeOrder, activeOrderRelation } from '../orders/order-filters';
```

- [ ] **Step 4: Apply the filter to all seven sites**

Line 17 — `getSummary`:

```typescript
    const orders = await this.prisma.order.findMany({
      where: activeOrder({ createdAt: range }),
      select: { createdAt: true, totalAmount: true, couponId: true },
    });
```

Lines 53 and 60 — `getTopItems`. Replace `where: { order: { createdAt: range } }` with `where: activeOrderRelation({ createdAt: range })` in **both** `orderItem.groupBy` and `orderItemTopping.groupBy`.

Lines 99–101 — `getDaily`:

```typescript
    const [orders, items, payments] = await Promise.all([
      this.prisma.order.count({ where: activeOrder({ createdAt: range }) }),
      this.prisma.orderItem.count({ where: activeOrderRelation({ createdAt: range }) }),
      this.prisma.orderPayment.groupBy({
        by: ['paymentMethod'],
        _sum: { amount: true },
        where: activeOrderRelation({ createdAt: range }),
      }),
    ]);
```

Line 144 — `getReconciliationSummary`:

```typescript
    const payments = await this.prisma.orderPayment.findMany({
      where: activeOrderRelation({ createdAt: range }),
      select: { paymentMethod: true, amount: true, order: { select: { createdAt: true } } },
    });
```

Do **not** touch `getReconciliation` (line ~115) — it only reads `dailyReconciliation` and has no order query.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- analytics.service.spec.ts
```

Expected: PASS — all previously existing analytics tests plus the 4 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts
git commit -m "fix(analytics): excluir pedidos anulados de todas las cifras"
```

---

## Task 4: Exclude cancelled orders from the inventory beverage overlay

**Files:**
- Modify: `helados-api/src/inventory/inventory.service.ts:139`
- Test: `helados-api/src/inventory/inventory.service.spec.ts`

**Interfaces:**
- Consumes: `activeOrderRelation` from Task 2
- Produces: nothing new

`withBeverageOverlay` subtracts beverages sold since a snapshot was taken. A cancelled order would make stock read artificially low.

- [ ] **Step 1: Write the failing test**

`withBeverageOverlay` is private and reached through `findOne`, which the existing spec already exercises this way (see the two tests right above where you're inserting: `'applies beverage overlay for BEVERAGE lines'` and `'returns 0 soldSince when no orders found for beverage'`). `mockPrisma.orderItem.groupBy` already exists in this file's `mockPrisma` — no mock setup needed.

Append this test directly after those two, inside the same `describe` block:

```typescript
    it('does not count cancelled orders as sold in the beverage overlay', async () => {
      const snap = {
        ...fakeSnapshot,
        lines: [{
          id: 'line3', snapshotId: 'snap1',
          productType: null, productSize: null,
          productId: 'bev3', product: { id: 'bev3', name: 'Refresco', type: 'BEVERAGE' },
          label: null, quantity: 5,
        }],
      };
      mockPrisma.inventorySnapshot.findUnique.mockResolvedValue(snap);
      mockPrisma.orderItem.groupBy.mockResolvedValue([]);

      await service.findOne('snap1');

      expect(mockPrisma.orderItem.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ cancelledAt: null }),
          }),
        }),
      );
    });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- inventory.service.spec.ts
```

Expected: FAIL — the received `where` has `order: { createdAt: {...} }` with no `cancelledAt`.

- [ ] **Step 3: Apply the filter**

Import at the top of `inventory.service.ts`:

```typescript
import { activeOrderRelation } from '../orders/order-filters';
```

Then at line 139:

```typescript
    const soldCounts = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      _count: { id: true },
      where: {
        productId: { in: beverageLines.map(l => l.productId as string) },
        ...activeOrderRelation({ createdAt: { gte: snapshot.takenAt } }),
      },
    });
```

The spread is safe here because the surrounding object has no `order` key of its own.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- inventory.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inventory/inventory.service.ts src/inventory/inventory.service.spec.ts
git commit -m "fix(inventory): no descontar bebidas de pedidos anulados"
```

---

## Task 5: The cancel DTO and service method

**Files:**
- Create: `helados-api/src/orders/dto/cancel-order.dto.ts`
- Modify: `helados-api/src/orders/orders.service.ts`
- Test: `helados-api/src/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `CancelReason` from the new DTO file
- Produces:
  - `CANCEL_REASONS: readonly ['REGISTRO_ERRONEO', 'CLIENTE_CANCELO', 'PRODUCTO_DEFECTUOSO', 'OTRO']`
  - `type CancelReason`
  - `class CancelOrderDto { reason: CancelReason }`
  - `CANCEL_WINDOW_MS: number` exported from `orders.service.ts`
  - `OrdersService.cancel(user: { sub: string; role: string }, orderId: string, reason: CancelReason): Promise<Order>`

- [ ] **Step 1: Create the DTO**

Create `helados-api/src/orders/dto/cancel-order.dto.ts`:

```typescript
import { IsEnum } from 'class-validator';

export const CANCEL_REASONS = [
  'REGISTRO_ERRONEO',
  'CLIENTE_CANCELO',
  'PRODUCTO_DEFECTUOSO',
  'OTRO',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export class CancelOrderDto {
  @IsEnum(CANCEL_REASONS, { message: 'Motivo de anulación no válido' })
  reason: CancelReason;
}
```

- [ ] **Step 2: Extend the test mocks**

In `orders.service.spec.ts`, update `mockPrisma` so the new calls are stubbed:

```typescript
const mockPrisma = {
  product: { findMany: jest.fn() },
  flavor: { findMany: jest.fn() },
  topping: { findMany: jest.fn() },
  order: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  coupon: { update: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
};
```

- [ ] **Step 3: Write the failing tests**

Append inside `describe('OrdersService', ...)`:

```typescript
  describe('cancel', () => {
    const admin = { sub: 'admin1', role: 'ADMIN' };
    const staff = { sub: 'staff1', role: 'STAFF' };

    function activeOrderRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'order1',
        staffId: 'staff1',
        couponId: null,
        createdAt: new Date(),
        cancelledAt: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.order.update.mockResolvedValue({ id: 'order1', cancelledAt: new Date() });
      mockPrisma.coupon.updateMany.mockResolvedValue({ count: 1 });
    });

    it('lets an ADMIN cancel any order regardless of age', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        activeOrderRow({ createdAt: new Date('2020-01-01T00:00:00Z') }),
      );

      await service.cancel(admin, 'order1', 'REGISTRO_ERRONEO');

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order1' },
          data: expect.objectContaining({
            cancelledBy: 'admin1',
            cancelReason: 'REGISTRO_ERRONEO',
          }),
        }),
      );
    });

    it('lets STAFF cancel their own order inside the window', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(activeOrderRow());

      await service.cancel(staff, 'order1', 'CLIENTE_CANCELO');

      expect(mockPrisma.order.update).toHaveBeenCalled();
    });

    it('rejects STAFF cancelling their own order past the window', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        activeOrderRow({ createdAt: new Date(Date.now() - 16 * 60 * 1000) }),
      );

      await expect(service.cancel(staff, 'order1', 'OTRO')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it("rejects STAFF cancelling another user's order", async () => {
      mockPrisma.order.findUnique.mockResolvedValue(activeOrderRow({ staffId: 'otro' }));

      await expect(service.cancel(staff, 'order1', 'OTRO')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects an already-cancelled order with 409', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(
        activeOrderRow({ cancelledAt: new Date() }),
      );

      await expect(service.cancel(admin, 'order1', 'OTRO')).rejects.toThrow(ConflictException);
    });

    it('throws 404 when the order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.cancel(admin, 'nope', 'OTRO')).rejects.toThrow(NotFoundException);
    });

    it('decrements the coupon usesCount, floored at zero', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(activeOrderRow({ couponId: 'c1' }));

      await service.cancel(admin, 'order1', 'REGISTRO_ERRONEO');

      expect(mockPrisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', usesCount: { gt: 0 } },
        data: { usesCount: { decrement: 1 } },
      });
    });

    it('does not touch coupons when the order had none', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(activeOrderRow({ couponId: null }));

      await service.cancel(admin, 'order1', 'OTRO');

      expect(mockPrisma.coupon.updateMany).not.toHaveBeenCalled();
    });
  });
```

Add `ConflictException` to the `@nestjs/common` import at the top of the spec file.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
npm test -- orders.service.spec.ts
```

Expected: FAIL — `service.cancel is not a function`, 8 failures.

- [ ] **Step 5: Implement `cancel()`**

In `orders.service.ts`, add `ConflictException` to the `@nestjs/common` import, add the DTO import, and export the window constant above the class:

```typescript
import { CancelReason } from './dto/cancel-order.dto';

/** Ventana en la que un STAFF puede anular su propio pedido. */
export const CANCEL_WINDOW_MS = 15 * 60 * 1000;
```

Add this private helper to `OrdersService` first. It is the **single** definition of the cancellation permission rule — Task 6 consumes it too, so do not restate these conditions anywhere else:

```typescript
  /**
   * Devuelve el mensaje de error si el usuario NO puede anular el pedido,
   * o null si sí puede. Única definición de la regla de permiso.
   */
  private cancelPermissionError(
    order: { staffId: string; createdAt: Date },
    user: { sub: string; role: string },
  ): string | null {
    if (user.role === 'ADMIN') return null;
    if (order.staffId !== user.sub) {
      return 'Solo puedes anular pedidos que registraste tú';
    }
    if (Date.now() - order.createdAt.getTime() > CANCEL_WINDOW_MS) {
      return 'El plazo de 15 minutos para anular este pedido ya venció. Pide a un administrador que lo anule.';
    }
    return null;
  }
```

Then add this method to `OrdersService`, after `findOne`:

```typescript
  async cancel(
    user: { sub: string; role: string },
    orderId: string,
    reason: CancelReason,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.cancelledAt) throw new ConflictException('El pedido ya está anulado');

    const permissionError = this.cancelPermissionError(order, user);
    if (permissionError) throw new UnprocessableEntityException(permissionError);

    return this.prisma.$transaction(async (tx) => {
      if (order.couponId) {
        // updateMany con `usesCount > 0` evita bajar de cero sin leer primero.
        await tx.coupon.updateMany({
          where: { id: order.couponId, usesCount: { gt: 0 } },
          data: { usesCount: { decrement: 1 } },
        });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          cancelledAt: new Date(),
          cancelledBy: user.sub,
          cancelReason: reason,
        },
        include: orderInclude,
      });
    });
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- orders.service.spec.ts
```

Expected: PASS — existing `create` tests plus the 8 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/orders/dto/cancel-order.dto.ts src/orders/orders.service.ts src/orders/orders.service.spec.ts
git commit -m "feat(orders): método de anulación con reglas de permiso y ventana de 15 min"
```

---

## Task 6: `canCancel` on order reads

**Files:**
- Modify: `helados-api/src/orders/orders.service.ts` (`findAll`, `findOne`)
- Test: `helados-api/src/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `CANCEL_WINDOW_MS` from Task 5
- Produces: `findAll(user, query)` and `findOne(user, id)` now take the requesting user first and return orders with an extra `canCancel: boolean`

The rule lives only on the server so the tablet clock can never disagree with it.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('OrdersService', ...)`:

```typescript
  describe('canCancel flag', () => {
    const admin = { sub: 'admin1', role: 'ADMIN' };
    const staff = { sub: 'staff1', role: 'STAFF' };

    function row(overrides: Record<string, unknown> = {}) {
      return {
        id: 'order1',
        staffId: 'staff1',
        createdAt: new Date(),
        cancelledAt: null,
        ...overrides,
      };
    }

    it('is true for an ADMIN on an old order', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        row({ createdAt: new Date('2020-01-01T00:00:00Z') }),
      ]);

      const result = await service.findAll(admin, {});

      expect(result[0].canCancel).toBe(true);
    });

    it('is true for the owning STAFF inside the window', async () => {
      mockPrisma.order.findMany.mockResolvedValue([row()]);

      const result = await service.findAll(staff, {});

      expect(result[0].canCancel).toBe(true);
    });

    it('is false for the owning STAFF past the window', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        row({ createdAt: new Date(Date.now() - 16 * 60 * 1000) }),
      ]);

      const result = await service.findAll(staff, {});

      expect(result[0].canCancel).toBe(false);
    });

    it("is false for STAFF on another user's order", async () => {
      mockPrisma.order.findMany.mockResolvedValue([row({ staffId: 'otro' })]);

      const result = await service.findAll(staff, {});

      expect(result[0].canCancel).toBe(false);
    });

    it('is false for an already-cancelled order, even for an ADMIN', async () => {
      mockPrisma.order.findMany.mockResolvedValue([row({ cancelledAt: new Date() })]);

      const result = await service.findAll(admin, {});

      expect(result[0].canCancel).toBe(false);
    });

    it('is applied by findOne too', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(row());

      const result = await service.findOne(staff, 'order1');

      expect(result.canCancel).toBe(true);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- orders.service.spec.ts
```

Expected: FAIL — `canCancel` is `undefined`.

- [ ] **Step 3: Implement the helper and thread the user through**

Add `computeCanCancel` to `OrdersService`. It **must** delegate to the `cancelPermissionError` helper created in Task 5 — the role/ownership/window conditions are defined once and only once. Re-implementing them here is a defect, because the flag and the endpoint would be free to drift apart:

```typescript
  private computeCanCancel(
    order: { staffId: string; createdAt: Date; cancelledAt: Date | null },
    user: { sub: string; role: string },
  ): boolean {
    if (order.cancelledAt) return false;
    return this.cancelPermissionError(order, user) === null;
  }
```

Change `findAll` to accept the user and decorate the results. Keep the existing date-range logic exactly as it is; only the signature and the return change:

```typescript
  async findAll(user: { sub: string; role: string }, query: GetOrdersQueryDto) {
    // ...la construcción de `where` existente no cambia...
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
    return orders.map((order) => ({
      ...order,
      canCancel: this.computeCanCancel(order, user),
    }));
  }
```

And `findOne`:

```typescript
  async findOne(user: { sub: string; role: string }, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException(`Pedido ${id} no encontrado`);
    return { ...order, canCancel: this.computeCanCancel(order, user) };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- orders.service.spec.ts
```

Expected: PASS. If older `findAll`/`findOne` tests now fail on arity, update those call sites to pass a user object — that is the intended signature change, not a regression.

- [ ] **Step 5: Commit**

```bash
git add src/orders/orders.service.ts src/orders/orders.service.spec.ts
git commit -m "feat(orders): exponer canCancel calculado en el servidor"
```

---

## Task 7: The `PATCH /orders/:id/cancel` route

**Files:**
- Modify: `helados-api/src/orders/orders.controller.ts`
- Test: `helados-api/src/orders/orders.controller.spec.ts` (create)

**Interfaces:**
- Consumes: `OrdersService.cancel`, `findAll`, `findOne` from Tasks 5–6; `CancelOrderDto` from Task 5
- Produces: `PATCH /orders/:id/cancel` accepting `{ reason }`

- [ ] **Step 1: Write the failing test**

Create `helados-api/src/orders/orders.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const mockOrdersService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  cancel: jest.fn(),
};

describe('OrdersController', () => {
  let controller: OrdersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: mockOrdersService }],
    }).compile();
    controller = module.get(OrdersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('passes the authenticated user, id and reason to the service', async () => {
    const req = { user: { sub: 'staff1', role: 'STAFF' } };
    mockOrdersService.cancel.mockResolvedValue({ id: 'order1' });

    await controller.cancel(req, 'order1', { reason: 'REGISTRO_ERRONEO' });

    expect(mockOrdersService.cancel).toHaveBeenCalledWith(
      { sub: 'staff1', role: 'STAFF' },
      'order1',
      'REGISTRO_ERRONEO',
    );
  });

  it('passes the authenticated user to findAll', async () => {
    const req = { user: { sub: 'staff1', role: 'STAFF' } };
    mockOrdersService.findAll.mockResolvedValue([]);

    await controller.findAll(req, {});

    expect(mockOrdersService.findAll).toHaveBeenCalledWith(
      { sub: 'staff1', role: 'STAFF' },
      {},
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- orders.controller.spec.ts
```

Expected: FAIL — `controller.cancel is not a function`.

- [ ] **Step 3: Update the controller**

Replace the contents of `orders.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

type AuthedRequest = { user: { sub: string; role: string } };

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  create(@Request() req: AuthedRequest, @Body() dto: CreateOrderDto) {
    return this.orders.create(req.user.sub, dto);
  }

  @Get()
  findAll(@Request() req: AuthedRequest, @Query() query: GetOrdersQueryDto) {
    return this.orders.findAll(req.user, query);
  }

  @Get(':id')
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.findOne(req.user, id);
  }

  @Patch(':id/cancel')
  cancel(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancel(req.user, id, dto.reason);
  }
}
```

No `RolesGuard` here — STAFF access depends on ownership and age, which a role check cannot express. The service enforces it.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/orders/orders.controller.ts src/orders/orders.controller.spec.ts
git commit -m "feat(orders): endpoint PATCH /orders/:id/cancel"
```

---

## Task 8: Frontend model and service

**Files:**
- Modify: `helados-ui/src/app/core/models/order.model.ts`
- Modify: `helados-ui/src/app/core/services/order.service.ts`

**Interfaces:**
- Consumes: the API shape from Tasks 5–7
- Produces:
  - `CancelReason` type and `CANCEL_REASON_LABELS: Record<CancelReason, string>`
  - `Order.cancelledAt`, `Order.cancelledByUser`, `Order.cancelReason`, `Order.canCancel`
  - `OrderService.cancel(id: string, reason: CancelReason)`

- [ ] **Step 1: Extend the model**

In `order.model.ts`, add above the `Order` interface:

```typescript
export type CancelReason =
  | 'REGISTRO_ERRONEO'
  | 'CLIENTE_CANCELO'
  | 'PRODUCTO_DEFECTUOSO'
  | 'OTRO';

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  REGISTRO_ERRONEO:    'Error al registrar',
  CLIENTE_CANCELO:     'Cliente canceló',
  PRODUCTO_DEFECTUOSO: 'Producto en mal estado',
  OTRO:                'Otro',
};
```

And add these four fields to the `Order` interface:

```typescript
  cancelledAt: string | null;
  cancelledByUser: { name: string } | null;
  cancelReason: CancelReason | null;
  canCancel: boolean;
```

- [ ] **Step 2: Add the service call**

In `order.service.ts`, extend the import and add the method:

```typescript
import { Order, CreateOrderPayload, CancelReason } from '../models/order.model';
```

```typescript
  cancel(id: string, reason: CancelReason) {
    return this.http.patch<Order>(`${this.url}/${id}/cancel`, { reason });
  }
```

- [ ] **Step 3: Verify the build**

From `helados-ui/`:

```bash
npx ng build --configuration=development
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/models/order.model.ts src/app/core/services/order.service.ts
git commit -m "feat(ui): modelo y servicio para anulación de pedidos"
```

---

## Task 9: Cancel flow in the order history

**Files:**
- Modify: `helados-ui/src/app/features/orders/order-history/order-history.component.ts`
- Modify: `helados-ui/src/app/features/orders/order-history/order-history.component.html`

**Interfaces:**
- Consumes: `OrderService.cancel`, `CANCEL_REASON_LABELS`, `Order.canCancel` from Task 8
- Produces: the user-facing cancel flow

- [ ] **Step 1: Add the component state and handlers**

In `order-history.component.ts`, extend the imports:

```typescript
import { Order, CancelReason, CANCEL_REASON_LABELS } from '../../../core/models/order.model';
```

Add these members to the class:

```typescript
  cancellingId: string | null = null;   // pedido con el panel de motivos abierto
  cancelError: string | null = null;
  submitting = false;

  readonly reasons = Object.entries(CANCEL_REASON_LABELS) as [CancelReason, string][];

  openCancel(order: Order, event: Event) {
    event.stopPropagation();          // no expandir/colapsar la fila
    this.cancellingId = order.id;
    this.cancelError  = null;
  }

  closeCancel() {
    this.cancellingId = null;
    this.cancelError  = null;
  }

  confirmCancel(orderId: string, reason: CancelReason) {
    this.submitting = true;
    this.cancelError = null;
    this.orderSvc.cancel(orderId, reason).subscribe({
      next: () => {
        this.submitting  = false;
        this.cancellingId = null;
        this.load();
      },
      error: (err) => {
        this.submitting = false;
        this.cancelError =
          err?.error?.message ?? 'No se pudo anular el pedido. Inténtalo de nuevo.';
      },
    });
  }

  reasonLabel(reason: CancelReason | null): string {
    return reason ? CANCEL_REASON_LABELS[reason] : '';
  }
```

`event.stopPropagation()` matters: the whole row is a `<button>` that toggles expansion, so without it the cancel tap would also collapse the row.

- [ ] **Step 2: Mark cancelled rows in the template**

In `order-history.component.html`, on the row `<button>` (around line 40), add a conditional class so cancelled orders read as voided:

```html
            [class.opacity-50]="!!order.cancelledAt"
```

Then in the right-hand total block, replace the existing total paragraph with:

```html
            <div class="text-right shrink-0">
              <p class="text-white font-bold" [class.line-through]="!!order.cancelledAt">
                {{ formatPrice(order.totalAmount) }}
              </p>
              @if (order.cancelledAt) {
                <span class="inline-block mt-1 px-2 py-0.5 rounded-full bg-red-900 text-red-200 text-[10px] font-bold tracking-wide">
                  ANULADO
                </span>
              } @else if (order.discountAmount > 0) {
                <p class="text-green-400 text-xs">-{{ formatPrice(order.discountAmount) }}</p>
              }
            </div>
```

- [ ] **Step 3: Show the audit line and the cancel UI in the expanded detail**

Inside the `@if (expandedId === order.id)` block, at the end of its `space-y-3` container:

```html
              @if (order.cancelledAt) {
                <div class="bg-red-950/50 border border-red-900 rounded-xl p-3 text-sm">
                  <p class="text-red-200 font-medium">Pedido anulado</p>
                  <p class="text-red-300/80 text-xs mt-0.5">
                    {{ reasonLabel(order.cancelReason) }}
                    @if (order.cancelledByUser) {
                      · por {{ order.cancelledByUser.name }}
                    }
                    · {{ order.cancelledAt | date:'dd/MM/yyyy HH:mm' }}
                  </p>
                </div>
              } @else if (order.canCancel) {
                @if (cancellingId === order.id) {
                  <div class="bg-gray-800 rounded-xl p-3 space-y-2">
                    <p class="text-white text-sm font-medium">¿Por qué se anula este pedido?</p>
                    <div class="grid grid-cols-2 gap-2">
                      @for (r of reasons; track r[0]) {
                        <button
                          type="button"
                          [disabled]="submitting"
                          (click)="confirmCancel(order.id, r[0])"
                          class="px-3 py-4 rounded-xl bg-gray-700 text-white text-sm font-medium active:bg-red-700 disabled:opacity-50 touch-manipulation"
                        >
                          {{ r[1] }}
                        </button>
                      }
                    </div>
                    @if (cancelError) {
                      <p class="text-red-400 text-xs">{{ cancelError }}</p>
                    }
                    <button
                      type="button"
                      (click)="closeCancel()"
                      class="w-full px-3 py-2 rounded-xl text-gray-400 text-sm touch-manipulation"
                    >
                      Volver
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    (click)="openCancel(order, $event)"
                    class="w-full px-3 py-3 rounded-xl border border-red-900 text-red-400 text-sm font-medium active:bg-red-950 touch-manipulation"
                  >
                    Anular pedido
                  </button>
                }
              }
```

The reason buttons are `py-4` in a 2-column grid — deliberately large touch targets for tablet use during service.

- [ ] **Step 4: Verify the build**

From `helados-ui/`:

```bash
npx ng build --configuration=development
```

Expected: build succeeds with no template errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/orders/order-history/
git commit -m "feat(ui): anular pedidos desde el historial"
```

---

## Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing code-facing

- [ ] **Step 1: Update `CLAUDE.md`**

In the OrdersModule row of the routes table, add the new route:

```
| **OrdersModule** | `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/cancel` — any auth; uses `CouponsService` |
```

Add `CancelReason` to the enums line, add the three cancellation fields to the `Order` row of the model table, and add this bullet after the split-payments one:

```markdown
**Order cancellation (soft void):**
- `cancelledAt IS NULL` means active — there is no `status` field
- ADMIN cancels anything; STAFF only their own orders within `CANCEL_WINDOW_MS` (15 min)
- Refusals are **422**, not 403 — the Angular interceptor redirects on any 403
- 8 of the 10 order read sites filter via `activeOrder()` / `activeOrderRelation()` in `src/orders/order-filters.ts`; the 2 in `orders.service.ts` stay unfiltered so history shows cancelled orders
- `canCancel` is computed server-side per order — do not reimplement the window rule in the frontend
```

Add a row to the plan roadmap table:

```
| — | ✅ Done | Order cancellation (soft void) with audit trail |
```

- [ ] **Step 2: Update `README.md`**

Add a row to the features table in *Descripción general*:

```markdown
| 🚫 | **Anulación de pedidos**: el staff corrige un error dentro de 15 min, el admin sin límite; los anulados dejan de contar en las cifras |
```

And add the route to the Orders row of the API table:

```
| **Orders** | `POST /orders` · `GET /orders` · `GET /orders/:id` · `PATCH /orders/:id/cancel` | autenticado |
```

- [ ] **Step 3: Final verification**

```bash
cd helados-api && npm test
cd ../helados-ui && npx ng build --configuration=development
```

Expected: all API suites pass; UI build succeeds.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: documentar la anulación de pedidos"
```

---

## Self-Review Notes

**Spec coverage:** Section 1 (data model) → Task 1. Section 2 (rules) → Task 5. Section 3 (API, 422 rationale, `canCancel`) → Tasks 5–7. Section 4 (8 filtered sites, 2 unfiltered) → Tasks 2–4. Section 5 (frontend) → Tasks 8–9. Section 6 (testing) → tests embedded in Tasks 2–7. Out-of-scope items are not implemented anywhere, as intended.

**Known deviation:** the spec's two plain constants became two helper functions (`activeOrder`, `activeOrderRelation`) because spreading a `{ order: {...} }` constant would overwrite the date-range relation filter and silently widen every analytics query. Documented at the top of the File Structure section.

**Type consistency:** `CancelReason` is defined once per side (`dto/cancel-order.dto.ts` on the API, `order.model.ts` on the UI) with identical members. `cancel(user, orderId, reason)` has the same argument order in the service, its tests, and the controller. `findAll(user, query)` and `findOne(user, id)` take the user first in the service, controller, and tests alike.
