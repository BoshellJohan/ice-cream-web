# Daily Cash Reconciliation Design Spec

**Date:** 2026-06-17
**Status:** Approved for implementation

---

## Goal

Let admins log the *actual* cash and QR amounts received on a given day and automatically see the variance against the system-recorded totals. This surfaces discrepancies caused by human error (e.g. staff forgetting to register an order). Values are persisted in the database so they survive refreshes and are available from any device (admins may log in from a PC).

**Variance formula:** `Variance = Actual Amount − System Amount`

---

## Section 1: Data Model

A new Prisma model storing one reconciliation record per calendar day:

```prisma
model DailyReconciliation {
  id          String   @id @default(uuid())
  date        DateTime @unique @db.Date   // the calendar day, e.g. 2026-06-17
  actualCash  Decimal  @db.Decimal(10, 2)
  actualQr    Decimal  @db.Decimal(10, 2)
  updatedBy   String                       // userId of the admin who last saved
  updatedAt   DateTime @updatedAt
}
```

- `date` uses `@db.Date` (no time component) and is `@unique` — one row per day. Saving again **upserts** the same row.
- `actualCash` / `actualQr` mirror the `Decimal(10, 2)` style used by `OrderPayment.amount`.
- `updatedBy` records which admin last entered the values (lightweight audit; the userId comes from the JWT).
- Migration created via `npx prisma migrate dev --name add_daily_reconciliation`.

---

## Section 2: API Endpoints

Two new routes on the existing `AnalyticsController`. Both are ADMIN-only, inheriting the class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN')`.

### `GET /analytics/reconciliation?date=YYYY-MM-DD`

Returns the saved record for that day, or `null` if none exists yet.

```typescript
{ actualCash: number, actualQr: number, updatedAt: string } | null
```

### `PUT /analytics/reconciliation`

Body:

```typescript
{ date: string, actualCash: number, actualQr: number }
```

- Upserts on `date` (create if new, update if exists).
- Stamps `updatedBy` from the authenticated JWT user.
- Returns the saved record (same shape as the GET response, non-null).

**Why PUT not POST:** the operation is idempotent — saving the same day's values repeatedly produces the same result. PUT fits upsert semantics.

### DTO

```typescript
// reconciliation.dto.ts
export class ReconciliationDto {
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0)
  actualCash: number;

  @IsNumber()
  @Min(0)
  actualQr: number;
}
```

The GET endpoint reuses the existing `AnalyticsDailyQueryDto` (`{ date: string }`).

### Service methods

- `getReconciliation(date: string)` — `findUnique` on `date`, maps Decimals to numbers, returns the record or `null`.
- `saveReconciliation(date: string, actualCash: number, actualQr: number, userId: string)` — `upsert` keyed on `date`, sets `updatedBy = userId`, returns the saved record.

### Variance

Variance is **not** stored or computed on the backend. It is a pure display calculation (`actual − system`) performed in the frontend, since the system values already live in the `getDaily` response. This keeps `getDaily` and the reconciliation endpoints independently testable.

---

## Section 3: Frontend — Single-Day View

Below the existing five metric cards in `daily.component.html`, add a **"Conciliación de caja"** section.

### Layout

```
Conciliación de caja
                 Sistema      Real          Diferencia
💵 Efectivo      $118.00      [125.00]      +$7.00   (green)
📱 QR            $130.20      [130.20]       $0.00   (gray)

[ Guardar ]      Última edición: 2026-06-17 14:32
```

### Behaviour

- Two numeric inputs: **Efectivo real** and **QR real**, pre-filled with saved values (blank if none saved yet).
- A **"Guardar"** button calls `PUT /analytics/reconciliation` for `dateA`.
- Variance per method shown once a value is entered.
- **Variance color coding:**
  - positive (actual > system → more money than recorded): green
  - negative (shortfall): red
  - zero: gray
- On load, the component fetches reconciliation **alongside** `getDaily`. If a saved record exists, show a small "Última edición: …" timestamp (from `updatedAt`).
- **Empty/unsaved state:** inputs blank, variance cells show `—` until a value is entered.

### Component state additions

```typescript
actualCashA: number | null = null;
actualQrA:   number | null = null;
savedReconA: ReconciliationData | null = null;   // last loaded/saved record
savingA = false;
```

### Variance getters

```typescript
cashVarianceA(): number | null   // actualCashA - dataA.cashRevenue, or null if no input
qrVarianceA():   number | null
```

A shared helper returns the Tailwind color class for a variance value (`text-green-400` / `text-red-400` / `text-gray-500`).

---

## Section 4: Frontend — Comparison View

Extend the existing comparison table (currently 5 rows × 3 columns: label | Día A | Día B) with a **"Conciliación"** subheader followed by four reconciliation rows.

### Layout

```
                        Día A           Día B
─────────────────────────────────────────────────
Pedidos                 27              18
Ítems                   38              24
Total                   $248.20         $166.50
💵 Efectivo (sistema)    $118.00         $92.00
📱 QR (sistema)          $130.20         $74.50
── Conciliación ──────────────────────────────────
💵 Efectivo real         [125.00]        [95.00]
   Diferencia            +$7.00          +$3.00
📱 QR real               [130.20]        [74.50]
   Diferencia             $0.00           $0.00
```

### Behaviour

- Each day's actual inputs and a **"Guardar"** button are editable inline per column.
- Save action is independent per column (Día A saves `dateA`, Día B saves `dateB`).
- Variance cells (Diferencia) use the same green/red/gray coding as the single-day view.
- When a day has no saved reconciliation, its real inputs are blank and its Diferencia shows `—`.

### State additions

```typescript
actualCashB: number | null = null;
actualQrB:   number | null = null;
savedReconB: ReconciliationData | null = null;
savingB = false;
```

`loadB()` and `startComparing()` also fetch Día B's reconciliation. `stopComparing()` clears Día B's reconciliation state.

### Variance getters (Día B)

```typescript
cashVarianceB(): number | null
qrVarianceB():   number | null
```

### Code organization note

The daily component HTML is already ~182 lines and this change roughly doubles the comparison table. The markup stays inline (matching the existing pattern), but all variance and save logic lives in clearly-named component methods to keep the template readable.

---

## Section 5: Frontend — Model & Service

### `analytics.model.ts` — add interface

```typescript
export interface ReconciliationData {
  actualCash: number;
  actualQr:   number;
  updatedAt:  string;
}
```

### `analytics.service.ts` — add methods

```typescript
getReconciliation(date: string) {
  const params = new HttpParams().set('date', date);
  return this.http.get<ReconciliationData | null>(`${this.url}/reconciliation`, { params });
}

saveReconciliation(date: string, actualCash: number, actualQr: number) {
  return this.http.put<ReconciliationData>(`${this.url}/reconciliation`, { date, actualCash, actualQr });
}
```

---

## Section 6: Testing

### Backend (TDD, in `analytics.service.spec.ts`)

Mock Prisma gains `dailyReconciliation: { findUnique: jest.fn(), upsert: jest.fn() }`.

Tests:
1. `getReconciliation` returns the saved record (with numeric `actualCash`/`actualQr`) for a day that has one.
2. `getReconciliation` returns `null` when no record exists for the day.
3. `saveReconciliation` creates a new record when none exists (upsert create path) and stamps `updatedBy`.
4. `saveReconciliation` updates the existing record for the same date (upsert update path), stamping `updatedBy`.

### Frontend

Build check only (`npx ng build --configuration=development`), consistent with how the existing daily component was verified. This codebase has no Angular component unit tests.

---

## Section 7: Files Changed

**Backend (create or modify):**
- `helados-api/prisma/schema.prisma` — add `DailyReconciliation` model
- `helados-api/prisma/migrations/<timestamp>_add_daily_reconciliation/` — generated migration
- `helados-api/src/analytics/dto/reconciliation.dto.ts` — create
- `helados-api/src/analytics/analytics.service.ts` — add `getReconciliation`, `saveReconciliation`
- `helados-api/src/analytics/analytics.service.spec.ts` — expand mock, add 4 tests
- `helados-api/src/analytics/analytics.controller.ts` — add `GET` + `PUT /analytics/reconciliation`

**Frontend (modify):**
- `helados-ui/src/app/core/models/analytics.model.ts` — add `ReconciliationData`
- `helados-ui/src/app/core/services/analytics.service.ts` — add `getReconciliation`, `saveReconciliation`
- `helados-ui/src/app/features/analytics/daily/daily.component.ts` — add reconciliation state, load/save methods, variance getters
- `helados-ui/src/app/features/analytics/daily/daily.component.html` — add single-day "Conciliación de caja" section + comparison-view reconciliation rows

---

## Out of Scope

- Editing reconciliation history / audit trail beyond `updatedBy` + `updatedAt`
- Variance for `totalRevenue` (only per-method cash/QR variance is required)
- Alerts/notifications when variance exceeds a threshold
- Reconciliation for date ranges (only single-day, per the daily view)
- Exporting reconciliation data
