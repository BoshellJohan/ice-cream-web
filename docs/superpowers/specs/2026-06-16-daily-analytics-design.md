# Daily Analytics & Day Comparison Design Spec

**Date:** 2026-06-16
**Status:** Approved for implementation

---

## Goal

Add a `/dashboard/daily` route that shows per-day sales metrics (order count, item count, revenue split by payment method) and lets admins optionally compare two days side-by-side.

---

## Section 1: Backend

### New endpoint

```
GET /analytics/daily?date=YYYY-MM-DD
```

**Auth:** JWT + ADMIN role (same as existing analytics routes).

**Response:**

```typescript
{
  orders:       number,   // count of Order rows for that day
  items:        number,   // count of OrderItem rows for that day
  totalRevenue: number,   // sum of Order.totalAmount for that day
  cashRevenue:  number,   // sum of OrderPayment.amount where paymentMethod = 'CASH'
  qrRevenue:    number,   // sum of OrderPayment.amount where paymentMethod = 'QR'
}
```

**Date range:** `date` is treated as a full calendar day — `gte: new Date(date)`, `lt: new Date(date) + 1 day` (same pattern as existing `dateRange` helper).

### New DTO

```typescript
// analytics-daily-query.dto.ts
export class AnalyticsDailyQueryDto {
  @IsDateString()
  date: string;
}
```

### Service method

Add `getDaily(date: string)` to `AnalyticsService`:

```typescript
async getDaily(date: string) {
  const range = this.dateRange(date, date);

  const [orders, items, payments] = await Promise.all([
    this.prisma.order.count({ where: { createdAt: range } }),
    this.prisma.orderItem.count({ where: { order: { createdAt: range } } }),
    this.prisma.orderPayment.groupBy({
      by: ['paymentMethod'],
      _sum: { amount: true },
      where: { order: { createdAt: range } },
    }),
  ]);

  const cashRevenue  = Number(payments.find(p => p.paymentMethod === 'CASH')?._sum.amount ?? 0);
  const qrRevenue    = Number(payments.find(p => p.paymentMethod === 'QR')?._sum.amount  ?? 0);
  const totalRevenue = Math.round((cashRevenue + qrRevenue) * 100) / 100;

  return { orders, items, totalRevenue, cashRevenue, qrRevenue };
}
```

### Tests

Add to `analytics.service.spec.ts`:
- Returns correct counts and revenue split for a day with mixed payments
- Returns all zeros for a day with no orders
- `cashRevenue` and `qrRevenue` are 0 when only one payment method was used that day

---

## Section 2: Frontend — Models & Service

### `analytics.model.ts` — add interface

```typescript
export interface DailyData {
  orders:       number;
  items:        number;
  totalRevenue: number;
  cashRevenue:  number;
  qrRevenue:    number;
}
```

### `analytics.service.ts` — add method

```typescript
getDaily(date: string): Observable<DailyData> {
  return this.http.get<DailyData>(`${this.base}/analytics/daily`, {
    params: { date },
  });
}
```

---

## Section 3: Frontend — DailyComponent

### Route

```
/dashboard/daily
```

Guard: `authGuard` + `adminGuard` (same as `/dashboard`).

### File location

```
helados-ui/src/app/features/analytics/daily/daily.component.ts
helados-ui/src/app/features/analytics/daily/daily.component.html
```

### Component behaviour

**On init:** Pre-fills `dateA` with today, loads Día A data immediately.

**Single-day mode (default):**
- Header: "Análisis diario" + "← Dashboard" back link
- Date picker for Día A + "Cargar" button
- Five metric cards: Pedidos, Ítems, Total, 💵 Efectivo, 📱 QR
- Below cards: "+ Comparar con otro día" button

**Comparison mode (after clicking "+ Comparar"):**
- Second date picker for Día B appears (pre-filled with yesterday)
- Día B data loads immediately
- Metric cards expand into two named columns: **Día A** (left) | **Día B** (right)
- Each column shows the same five metrics independently
- "✕ Quitar comparación" link collapses back to single-day view and clears Día B data

**Loading states:** Each day loads independently. While loading, its column shows a skeleton/spinner. Errors per column show a "No se pudo cargar" message without affecting the other.

**Empty day:** If a date has no orders, all five metrics show `$0.00` / `0` — not an error.

### Component state

```typescript
dateA = '';          // YYYY-MM-DD
dateB = '';          // YYYY-MM-DD
dataA: DailyData | null = null;
dataB: DailyData | null = null;
loadingA = false;
loadingB = false;
errorA   = '';
errorB   = '';
comparing = false;   // toggles comparison mode
```

### Card layout (single-day)

```
[ Pedidos ]  [ Ítems ]  [ Total ]
[ 💵 Efectivo ]  [ 📱 QR ]
```

### Card layout (comparison)

```
           Día A         Día B
Pedidos    27            18
Ítems      38            24
Total      $248.20       $166.50
Efectivo   $118.00       $92.00
QR         $130.20       $74.50
```

---

## Section 4: Frontend — Navigation

### Dashboard → Daily link

Add a "Ver análisis diario →" button to `dashboard.component.html` (e.g. in the header row alongside the date filters). Navigates to `/dashboard/daily` using `routerLink`.

### Daily → Dashboard back link

The daily component header shows a "← Dashboard" link (`routerLink="/dashboard"`).

---

## Section 5: Files Changed

**Backend (create or modify):**
- `helados-api/src/analytics/dto/analytics-daily-query.dto.ts` — create
- `helados-api/src/analytics/analytics.service.ts` — add `getDaily`
- `helados-api/src/analytics/analytics.controller.ts` — add `GET /analytics/daily`
- `helados-api/src/analytics/analytics.service.spec.ts` — add 3 tests

**Frontend (create or modify):**
- `helados-ui/src/app/core/models/analytics.model.ts` — add `DailyData`
- `helados-ui/src/app/core/services/analytics.service.ts` — add `getDaily`
- `helados-ui/src/app/features/analytics/daily/daily.component.ts` — create
- `helados-ui/src/app/features/analytics/daily/daily.component.html` — create
- `helados-ui/src/app/app.routes.ts` — add `/dashboard/daily` route
- `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html` — add nav link

---

## Out of Scope

- Delta percentage between the two days (can be added later)
- Charts or graphs on the daily view
- Comparing more than two days at once
- Exporting data
