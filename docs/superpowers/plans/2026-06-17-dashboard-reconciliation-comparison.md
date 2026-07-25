# Dashboard Reconciliation Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /analytics/reconciliation-summary` endpoint that aggregates system (tracked) vs actual (reconciled) revenue over the reconciled days within a date range, and surface it on the main dashboard as a three-KPI-card comparison (Sistema / Real / Diferencia) with a per-method breakdown and coverage badge.

**Architecture:** A new `getReconciliationSummary(from, to)` method on `AnalyticsService` loads reconciliation rows in range, derives the covered-day set, and sums `OrderPayment` cash/QR only for those days (apples-to-apples). A new ADMIN-only controller route exposes it. The dashboard fetches it in its existing `forkJoin` and renders a comparison section; variance (`actual − system`) and % gap are computed client-side.

**Tech Stack:** NestJS 11 + Prisma 5 (backend); Angular 18 standalone components + Tailwind CSS (frontend).

---

## File Map

**Backend — modify:**
| File | Action |
|---|---|
| `helados-api/src/analytics/analytics.service.ts` | Add `getReconciliationSummary` |
| `helados-api/src/analytics/analytics.service.spec.ts` | Expand mock, add 4 tests |
| `helados-api/src/analytics/analytics.controller.ts` | Add `GET /analytics/reconciliation-summary` |

**Frontend — modify:**
| File | Action |
|---|---|
| `helados-ui/src/app/core/models/analytics.model.ts` | Add `ReconciliationSummaryData` |
| `helados-ui/src/app/core/services/analytics.service.ts` | Add `getReconciliationSummary` |
| `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts` | State, forkJoin load, variance helpers/getters |
| `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html` | Comparison section |

---

## Task 1: Backend — Aggregation Service Method (TDD)

**Files:**
- Modify: `helados-api/src/analytics/analytics.service.spec.ts`
- Modify: `helados-api/src/analytics/analytics.service.ts`

- [ ] **Step 1: Expand `mockPrisma` in the spec file**

Open `helados-api/src/analytics/analytics.service.spec.ts`. The `mockPrisma` constant already has `dailyReconciliation: { findUnique, upsert }` and `orderPayment: { groupBy }`. Add `findMany` to both. Replace the `mockPrisma` constant with:

```typescript
const mockPrisma = {
  order:               { findMany: jest.fn(), count: jest.fn() },
  orderItem:           { groupBy: jest.fn(), count: jest.fn() },
  orderItemTopping:    { groupBy: jest.fn() },
  orderPayment:        { groupBy: jest.fn(), findMany: jest.fn() },
  flavor:              { findMany: jest.fn() },
  topping:             { findMany: jest.fn() },
  dailyReconciliation: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
};
```

- [ ] **Step 2: Write 4 failing tests for `getReconciliationSummary`**

Add this `describe` block inside `describe('AnalyticsService', ...)`, after the existing `saveReconciliation` block:

```typescript
  describe('getReconciliationSummary', () => {
    it('aggregates system and actual only for days that have reconciliation', async () => {
      // Day 2026-06-15 has reconciliation; 2026-06-16 does not.
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([
        { date: new Date('2026-06-15'), actualCash: '100.00', actualQr: '50.00' },
      ]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: '90.00', order: { createdAt: new Date('2026-06-15T10:00:00Z') } },
        { paymentMethod: 'QR',   amount: '45.00', order: { createdAt: new Date('2026-06-15T12:00:00Z') } },
        { paymentMethod: 'CASH', amount: '999.00', order: { createdAt: new Date('2026-06-16T10:00:00Z') } },
      ]);

      const result = await service.getReconciliationSummary('2026-06-15', '2026-06-16');

      expect(result.systemCash).toBeCloseTo(90.0, 2);
      expect(result.systemQr).toBeCloseTo(45.0, 2);
      expect(result.systemTotal).toBeCloseTo(135.0, 2);
      expect(result.actualCash).toBeCloseTo(100.0, 2);
      expect(result.actualQr).toBeCloseTo(50.0, 2);
      expect(result.actualTotal).toBeCloseTo(150.0, 2);
      expect(result.daysReconciled).toBe(1);
    });

    it('sums per-method across multiple covered days', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([
        { date: new Date('2026-06-15'), actualCash: '100.00', actualQr: '50.00' },
        { date: new Date('2026-06-16'), actualCash: '20.00',  actualQr: '10.00' },
      ]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: '90.00', order: { createdAt: new Date('2026-06-15T10:00:00Z') } },
        { paymentMethod: 'QR',   amount: '45.00', order: { createdAt: new Date('2026-06-15T12:00:00Z') } },
        { paymentMethod: 'CASH', amount: '15.00', order: { createdAt: new Date('2026-06-16T09:00:00Z') } },
      ]);

      const result = await service.getReconciliationSummary('2026-06-15', '2026-06-16');

      expect(result.systemCash).toBeCloseTo(105.0, 2);
      expect(result.systemQr).toBeCloseTo(45.0, 2);
      expect(result.systemTotal).toBeCloseTo(150.0, 2);
      expect(result.actualTotal).toBeCloseTo(180.0, 2);
      expect(result.daysReconciled).toBe(2);
    });

    it('returns zeros and daysReconciled 0 when no reconciliation in range', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([
        { paymentMethod: 'CASH', amount: '90.00', order: { createdAt: new Date('2026-06-15T10:00:00Z') } },
      ]);

      const result = await service.getReconciliationSummary('2026-06-15', '2026-06-16');

      expect(result.systemCash).toBe(0);
      expect(result.systemQr).toBe(0);
      expect(result.systemTotal).toBe(0);
      expect(result.actualTotal).toBe(0);
      expect(result.daysReconciled).toBe(0);
    });

    it('computes daysInRange inclusively', async () => {
      mockPrisma.dailyReconciliation.findMany.mockResolvedValue([]);
      mockPrisma.orderPayment.findMany.mockResolvedValue([]);

      const result = await service.getReconciliationSummary('2026-06-11', '2026-06-17');

      expect(result.daysInRange).toBe(7);
    });
  });
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `cd helados-api && npm test -- --testPathPattern=analytics.service`
Expected: 4 failures (`service.getReconciliationSummary is not a function`). Pre-existing tests still pass.

- [ ] **Step 4: Implement the service method**

Open `helados-api/src/analytics/analytics.service.ts`. Add this method after `saveReconciliation`:

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

    const daysInRange = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;

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

- [ ] **Step 5: Run tests — verify all pass**

Run: `cd helados-api && npm test -- --testPathPattern=analytics.service`
Expected: all tests pass (4 new + pre-existing).

- [ ] **Step 6: Commit**

```bash
git add helados-api/src/analytics/analytics.service.ts \
        helados-api/src/analytics/analytics.service.spec.ts
git commit -m "feat(dashboard): add getReconciliationSummary service method with TDD tests"
```

---

## Task 2: Backend — Controller Route

**Files:**
- Modify: `helados-api/src/analytics/analytics.controller.ts`

- [ ] **Step 1: Add the route**

Open `helados-api/src/analytics/analytics.controller.ts`. Add a new `@Get('reconciliation-summary')` handler that reuses the existing `AnalyticsQueryDto` (already imported). Add this method after the existing `getTopItems` handler (or anywhere inside the class):

```typescript
  @Get('reconciliation-summary')
  getReconciliationSummary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getReconciliationSummary(query.from, query.to);
  }
```

No new imports are needed — `Get`, `Query`, and `AnalyticsQueryDto` are already imported in this file.

- [ ] **Step 2: Run the full backend test suite**

Run: `cd helados-api && npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add helados-api/src/analytics/analytics.controller.ts
git commit -m "feat(dashboard): add GET /analytics/reconciliation-summary route"
```

---

## Task 3: Frontend — Model + Service

**Files:**
- Modify: `helados-ui/src/app/core/models/analytics.model.ts`
- Modify: `helados-ui/src/app/core/services/analytics.service.ts`

- [ ] **Step 1: Add the `ReconciliationSummaryData` interface**

Open `helados-ui/src/app/core/models/analytics.model.ts`. Append at the end:

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

- [ ] **Step 2: Add the service method**

Open `helados-ui/src/app/core/services/analytics.service.ts`. Add `ReconciliationSummaryData` to the model import, and add the method. The import line becomes:

```typescript
import { DailyData, ReconciliationData, ReconciliationSummaryData, SummaryData, TopItemsData } from '../models/analytics.model';
```

Add this method inside the `AnalyticsService` class (e.g. after `getReconciliation`):

```typescript
  getReconciliationSummary(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<ReconciliationSummaryData>(`${this.url}/reconciliation-summary`, { params });
  }
```

- [ ] **Step 3: Build check**

Run: `cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20`
Expected: build succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add helados-ui/src/app/core/models/analytics.model.ts \
        helados-ui/src/app/core/services/analytics.service.ts
git commit -m "feat(dashboard): add ReconciliationSummaryData model and service method"
```

---

## Task 4: Frontend — Dashboard Component Logic

**Files:**
- Modify: `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts`

- [ ] **Step 1: Replace the component class**

Open `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts`. Replace the ENTIRE file with this version. It adds: the `ReconciliationSummaryData` import; `reconSummary` state; the third `forkJoin` stream; variance getters (`totalVariance`, `cashVariance`, `qrVariance`); and `varianceClass`/`formatVariance` helpers. `CommonModule` is already imported, so `[ngClass]` works in the template — no import change needed there.

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { SummaryData, TopItemsData, ReconciliationSummaryData } from '../../../core/models/analytics.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private analyticsSvc = inject(AnalyticsService);

  fromDate = '';
  toDate   = '';

  summary:     SummaryData               | null = null;
  topItems:    TopItemsData              | null = null;
  reconSummary: ReconciliationSummaryData | null = null;

  loading = false;
  error   = '';

  ngOnInit() {
    const today   = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 6);
    this.fromDate = weekAgo.toISOString().split('T')[0];
    this.toDate   = today.toISOString().split('T')[0];
    this.load();
  }

  load() {
    this.loading = true;
    this.error   = '';
    forkJoin({
      summary:      this.analyticsSvc.getSummary(this.fromDate, this.toDate),
      topItems:     this.analyticsSvc.getTopItems(this.fromDate, this.toDate),
      reconSummary: this.analyticsSvc.getReconciliationSummary(this.fromDate, this.toDate),
    }).subscribe({
      next: ({ summary, topItems, reconSummary }) => {
        this.summary      = summary;
        this.topItems     = topItems;
        this.reconSummary = reconSummary;
        this.loading      = false;
      },
      error: () => {
        this.error   = 'Error al cargar datos';
        this.loading = false;
      },
    });
  }

  setLastDays(days: number) {
    const today = new Date();
    const from  = new Date();
    from.setDate(today.getDate() - (days - 1));
    this.fromDate = from.toISOString().split('T')[0];
    this.toDate   = today.toISOString().split('T')[0];
    this.load();
  }

  maxFlavorCount():  number { return this.topItems?.topFlavors?.[0]?.count    ?? 1; }
  maxToppingQty():   number { return this.topItems?.topToppings?.[0]?.quantity ?? 1; }

  // Variance = actual - system (null when no reconciliation summary loaded)
  totalVariance(): number | null {
    if (!this.reconSummary) return null;
    return this.reconSummary.actualTotal - this.reconSummary.systemTotal;
  }

  cashVariance(): number | null {
    if (!this.reconSummary) return null;
    return this.reconSummary.actualCash - this.reconSummary.systemCash;
  }

  qrVariance(): number | null {
    if (!this.reconSummary) return null;
    return this.reconSummary.actualQr - this.reconSummary.systemQr;
  }

  varianceClass(v: number | null): string {
    if (v === null || v === 0) return 'text-gray-500';
    return v > 0 ? 'text-green-400' : 'text-red-400';
  }

  formatVariance(v: number | null): string {
    if (v === null) return '—';
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    return `${sign}$${Math.abs(v).toFixed(2)}`;
  }

  formatPrice(n: number) { return `$${Number(n).toFixed(2)}`; }
}
```

- [ ] **Step 2: Build check**

Run: `cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20`
Expected: build succeeds, no errors. (The new template section comes in Task 5; the new members are unused until then, which is fine.)

- [ ] **Step 3: Commit**

```bash
git add helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts
git commit -m "feat(dashboard): add reconciliation summary state, load, and variance logic"
```

---

## Task 5: Frontend — Dashboard Comparison Section (HTML)

**Files:**
- Modify: `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html`

- [ ] **Step 1: Insert the comparison section after the KPI card row**

Open `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html`. Find the end of the existing KPI card grid, which is immediately followed by the daily-revenue block. The exact snippet to match is the grid-closing `</div>`, a blank line, and the `<!-- Daily revenue -->` comment:

```html
    </div>

    <!-- Daily revenue -->
```

Replace that exact snippet with the following (it keeps the grid-closing `</div>`, inserts the reconciliation section, then restores the blank line + `<!-- Daily revenue -->` comment):

```html
    </div>

    <!-- Cash reconciliation comparison -->
    @if (reconSummary) {
      <div class="bg-gray-900 rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-white font-semibold">Conciliación de caja</h2>
          <span class="text-gray-400 text-xs bg-gray-800 rounded-full px-3 py-1">
            {{ reconSummary.daysReconciled }} de {{ reconSummary.daysInRange }} días
          </span>
        </div>

        @if (reconSummary.daysReconciled > 0) {
          <!-- Sistema / Real / Diferencia -->
          <div class="grid grid-cols-3 gap-4">
            <div class="bg-gray-800 rounded-xl p-4">
              <p class="text-gray-400 text-sm">Sistema</p>
              <p class="text-2xl font-bold text-white mt-1">{{ formatPrice(reconSummary.systemTotal) }}</p>
              <p class="text-gray-500 text-xs mt-1">registrado</p>
            </div>
            <div class="bg-gray-800 rounded-xl p-4">
              <p class="text-gray-400 text-sm">Real</p>
              <p class="text-2xl font-bold text-white mt-1">{{ formatPrice(reconSummary.actualTotal) }}</p>
              <p class="text-gray-500 text-xs mt-1">conciliado</p>
            </div>
            <div class="bg-gray-800 rounded-xl p-4">
              <p class="text-gray-400 text-sm">Diferencia</p>
              <p class="text-2xl font-bold mt-1" [ngClass]="varianceClass(totalVariance())">{{ formatVariance(totalVariance()) }}</p>
              @if (reconSummary.systemTotal !== 0) {
                <p class="text-xs mt-1" [ngClass]="varianceClass(totalVariance())">
                  {{ ((totalVariance()! / reconSummary.systemTotal) * 100).toFixed(1) }}%
                </p>
              }
            </div>
          </div>

          <!-- Per-method breakdown -->
          <div class="space-y-2 text-sm">
            <div class="flex items-center gap-2">
              <span class="text-gray-300 w-28 shrink-0">💵 Efectivo</span>
              <span class="text-gray-500">Sistema {{ formatPrice(reconSummary.systemCash) }}</span>
              <span class="text-gray-600">·</span>
              <span class="text-gray-500">Real {{ formatPrice(reconSummary.actualCash) }}</span>
              <span class="ml-auto font-medium" [ngClass]="varianceClass(cashVariance())">{{ formatVariance(cashVariance()) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-300 w-28 shrink-0">📱 QR</span>
              <span class="text-gray-500">Sistema {{ formatPrice(reconSummary.systemQr) }}</span>
              <span class="text-gray-600">·</span>
              <span class="text-gray-500">Real {{ formatPrice(reconSummary.actualQr) }}</span>
              <span class="ml-auto font-medium" [ngClass]="varianceClass(qrVariance())">{{ formatVariance(qrVariance()) }}</span>
            </div>
          </div>
        } @else {
          <p class="text-gray-500 text-sm">Sin conciliación en este período. Registra el efectivo/QR real en Análisis diario.</p>
        }
      </div>
    }

    <!-- Daily revenue -->
```

- [ ] **Step 2: Build check**

Run: `cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20`
Expected: build succeeds, no errors.

- [ ] **Step 3: Run the full backend test suite one final time**

Run: `cd helados-api && npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add helados-ui/src/app/features/analytics/dashboard/dashboard.component.html
git commit -m "feat(dashboard): add system-vs-actual reconciliation comparison section"
```
