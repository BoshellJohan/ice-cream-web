# Dashboard Reconciliation Comparison Design Spec

**Date:** 2026-06-17
**Status:** Approved for implementation

---

## Goal

Bring the daily cash-reconciliation data (admin-entered actual cash/QR) into the main `/dashboard` view, alongside the existing inventory-/order-based earnings. Add a high-level comparison — System (tracked) revenue vs Actual (reconciled) revenue, with variance and per-method breakdown — so admins can instantly gauge financial health and spot tracking gaps across the selected date range.

**Variance formula:** `Variance = Actual − System` (negative = shortfall / untracked sales).

---

## Section 1: Backend — Aggregation Endpoint

### New endpoint

```
GET /analytics/reconciliation-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
```

**Auth:** JWT + ADMIN (inherits the class-level guards on `AnalyticsController`).

**Response:**

```typescript
{
  daysReconciled: number,   // count of reconciliation rows within the range
  daysInRange:    number,   // calendar days from..to inclusive
  systemCash:  number,
  systemQr:    number,
  systemTotal: number,      // systemCash + systemQr, rounded to 2 decimals
  actualCash:  number,
  actualQr:    number,
  actualTotal: number,      // actualCash + actualQr, rounded to 2 decimals
}
```

### Apples-to-apples rule

The comparison only counts **days that have a reconciliation row**. A day with sales but no reconciliation is excluded from **both** the system and actual sides, so the totals always cover the same set of days. The "system" side uses `OrderPayment` cash/QR amounts (not `Order.totalAmount`), matching what reconciliation measures — consistent with the per-method variance already on the daily page.

### Service method

Add `getReconciliationSummary(from: string, to: string)` to `AnalyticsService`:

```typescript
async getReconciliationSummary(from: string, to: string) {
  const range = this.dateRange(from, to);

  const recons = await this.prisma.dailyReconciliation.findMany({
    where: { date: range },
    select: { date: true, actualCash: true, actualQr: true },
  });

  const coveredDays = new Set(recons.map(r => r.date.toISOString().split('T')[0]));

  let actualCash = 0;
  let actualQr = 0;
  for (const r of recons) {
    actualCash += Number(r.actualCash);
    actualQr += Number(r.actualQr);
  }

  const payments = await this.prisma.orderPayment.findMany({
    where: { order: { createdAt: range } },
    select: { paymentMethod: true, amount: true, order: { select: { createdAt: true } } },
  });

  let systemCash = 0;
  let systemQr = 0;
  for (const p of payments) {
    const day = p.order.createdAt.toISOString().split('T')[0];
    if (!coveredDays.has(day)) continue;
    if (p.paymentMethod === 'CASH') systemCash += Number(p.amount);
    else if (p.paymentMethod === 'QR') systemQr += Number(p.amount);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  systemCash = round(systemCash);
  systemQr = round(systemQr);
  actualCash = round(actualCash);
  actualQr = round(actualQr);

  const gte = new Date(from);
  const to2 = new Date(to);
  const daysInRange = Math.round((to2.getTime() - gte.getTime()) / 86400000) + 1;

  return {
    daysReconciled: coveredDays.size,
    daysInRange,
    systemCash,
    systemQr,
    systemTotal: round(systemCash + systemQr),
    actualCash,
    actualQr,
    actualTotal: round(actualCash + actualQr),
  };
}
```

**Performance note:** The fetch-and-bucket approach (loading payments in range and grouping in JS) is intentional. This is a low-volume internal app (4–5 staff, one shop); it avoids N per-day `groupBy` queries and keeps the covered-day intersection logic in one place.

### Controller route

```typescript
@Get('reconciliation-summary')
getReconciliationSummary(@Query() query: AnalyticsQueryDto) {
  return this.analytics.getReconciliationSummary(query.from, query.to);
}
```

Reuses the existing `AnalyticsQueryDto` (`{ from, to }`).

---

## Section 2: Frontend — Model & Service

### `analytics.model.ts` — add interface

```typescript
export interface ReconciliationSummaryData {
  daysReconciled: number;
  daysInRange:    number;
  systemCash:  number;
  systemQr:    number;
  systemTotal: number;
  actualCash:  number;
  actualQr:    number;
  actualTotal: number;
}
```

### `analytics.service.ts` — add method

```typescript
getReconciliationSummary(from: string, to: string) {
  const params = new HttpParams().set('from', from).set('to', to);
  return this.http.get<ReconciliationSummaryData>(`${this.url}/reconciliation-summary`, { params });
}
```

Mirrors the existing `getSummary`/`getTopItems` signature, so it slots into the dashboard's `forkJoin` load and re-fires whenever the date range changes.

---

## Section 3: Frontend — Dashboard UI

### Placement

In `dashboard.component.html`, directly **after** the existing KPI card row (Ingresos / Pedidos / Con cupón) and **before** the "Ingresos por día" block. Rendered only once `reconSummary` is loaded.

### Header line

`Conciliación de caja` + a coverage badge: `{{ reconSummary.daysReconciled }} de {{ reconSummary.daysInRange }} días`.

### When `daysReconciled > 0` — three KPI cards

```
┌ Sistema ────────┐ ┌ Real ───────────┐ ┌ Diferencia ─────────┐
│ $1,240.00       │ │ $1,198.00       │ │ −$42.00  (red)      │
│ registrado      │ │ conciliado      │ │ −3.4%               │
└─────────────────┘ └─────────────────┘ └─────────────────────┘
   💵 Efectivo:  Sistema $820.00 · Real $790.00 · −$30.00   (red)
   📱 QR:        Sistema $420.00 · Real $408.00 · −$12.00   (red)
```

- **Sistema** card: `formatPrice(systemTotal)`, label "registrado".
- **Real** card: `formatPrice(actualTotal)`, label "conciliado".
- **Diferencia** card (focal point): `actualTotal − systemTotal`, color-coded via `varianceClass`, formatted via `formatVariance`. Underneath, the % gap = `variance / systemTotal × 100`, shown only when `systemTotal !== 0`.
- Below the cards, a compact per-method line for cash and QR — each showing `Sistema`, `Real`, and the variance (color-coded): cash variance = `actualCash − systemCash`, QR variance = `actualQr − systemQr`.

### When `daysReconciled === 0` — empty state

A single muted card:

> "Sin conciliación en este período. Registra el efectivo/QR real en Análisis diario."

No numbers are shown, to avoid implying a $0 actual.

### Component additions (`dashboard.component.ts`)

- State: `reconSummary: ReconciliationSummaryData | null = null;`
- Load it inside the existing `forkJoin` alongside `summary` and `topItems`; assign in the `next` handler; reset/ignore on error consistent with current behavior.
- Add helpers (same implementations as `DailyComponent`):

```typescript
varianceClass(v: number | null): string {
  if (v === null || v === 0) return 'text-gray-500';
  return v > 0 ? 'text-green-400' : 'text-red-400';
}

formatVariance(v: number | null): string {
  if (v === null) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
```

- Variance getters for the template:

```typescript
totalVariance(): number | null { ... actualTotal - systemTotal ... }
cashVariance():  number | null { ... actualCash  - systemCash  ... }
qrVariance():    number | null { ... actualQr    - systemQr    ... }
```

Each returns `null` when `reconSummary` is null. The total-% is computed inline in the template (guarded by `systemTotal !== 0`).

This small, component-local duplication of `varianceClass`/`formatVariance` is acceptable per the codebase's existing style; a shared util is not warranted for two consumers (YAGNI).

---

## Section 4: Testing

### Backend (TDD, in `analytics.service.spec.ts`)

Mock Prisma gains `dailyReconciliation: { findMany }` and `orderPayment: { findMany }` (in addition to existing mocks). Tests for `getReconciliationSummary`:

1. **Covered-days-only aggregation:** range has Day1 (reconciliation + payments) and Day2 (payments but no reconciliation). Assert `systemCash`/`systemQr` include only Day1's payments, `actualCash`/`actualQr` sum Day1's reconciliation, `daysReconciled === 1`.
2. **Per-method totals:** mixed CASH/QR payments on covered days produce correct `systemCash`, `systemQr`, `systemTotal`, and matching `actualCash`/`actualQr`/`actualTotal`.
3. **No reconciliation in range:** `dailyReconciliation.findMany` returns `[]` → all amounts `0`, `daysReconciled === 0`, `daysInRange` still reflects the calendar range.
4. **`daysInRange` correctness:** `from`/`to` spanning 7 calendar days yields `daysInRange === 7`.

### Frontend

Angular build check only (`npx ng build --configuration=development`), consistent with the rest of this codebase (no component unit tests).

---

## Section 5: Files Changed

**Backend (modify):**
- `helados-api/src/analytics/analytics.service.ts` — add `getReconciliationSummary`
- `helados-api/src/analytics/analytics.service.spec.ts` — expand mock, add 4 tests
- `helados-api/src/analytics/analytics.controller.ts` — add `GET /analytics/reconciliation-summary`

**Frontend (modify):**
- `helados-ui/src/app/core/models/analytics.model.ts` — add `ReconciliationSummaryData`
- `helados-ui/src/app/core/services/analytics.service.ts` — add `getReconciliationSummary`
- `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts` — state, forkJoin load, variance helpers/getters
- `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html` — comparison section (cards + per-method + coverage + empty state)

---

## Out of Scope

- A daily-by-daily variance chart on the dashboard (this is a range-aggregate KPI)
- Editing reconciliation from the dashboard (entry stays on the daily page)
- Variance thresholds / alerts
- Reconciliation of order totals beyond cash/QR payment methods
- Exporting the comparison
