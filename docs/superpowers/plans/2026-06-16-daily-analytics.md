# Daily Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /analytics/daily?date=YYYY-MM-DD` backend endpoint and a `/dashboard/daily` Angular route that shows per-day order count, item count, and Cash/QR revenue split, with optional two-day comparison mode.

**Architecture:** Backend adds a single `getDaily(date)` method to `AnalyticsService` reusing the existing `dateRange` helper, backed by three Prisma queries in `Promise.all`. Frontend adds a `DailyComponent` with independent loading state per day; the comparison mode is toggled by a button, not a separate route. Routing uses a flat `/dashboard/daily` path (no parent shell change).

**Tech Stack:** NestJS 11 + Prisma 5 + class-validator (backend); Angular 18 standalone components, Tailwind CSS, HttpClient (frontend).

---

## File Map

**Backend — create or modify:**
| File | Action |
|---|---|
| `helados-api/src/analytics/dto/analytics-daily-query.dto.ts` | Create — single `date: string` field with `@IsDateString()` |
| `helados-api/src/analytics/analytics.service.ts` | Modify — add `getDaily(date)` method |
| `helados-api/src/analytics/analytics.service.spec.ts` | Modify — expand `mockPrisma`, add 3 `getDaily` tests |
| `helados-api/src/analytics/analytics.controller.ts` | Modify — add `GET /analytics/daily` route |

**Frontend — create or modify:**
| File | Action |
|---|---|
| `helados-ui/src/app/core/models/analytics.model.ts` | Modify — add `DailyData` interface |
| `helados-ui/src/app/core/services/analytics.service.ts` | Modify — add `getDaily(date)` method |
| `helados-ui/src/app/features/analytics/daily/daily.component.ts` | Create |
| `helados-ui/src/app/features/analytics/daily/daily.component.html` | Create |
| `helados-ui/src/app/app.routes.ts` | Modify — add `/dashboard/daily` route |
| `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts` | Modify — add `RouterLink` import |
| `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html` | Modify — add "Ver análisis diario →" link |

---

## Task 1: Backend — DTO + Service Method (TDD)

**Files:**
- Create: `helados-api/src/analytics/dto/analytics-daily-query.dto.ts`
- Modify: `helados-api/src/analytics/analytics.service.spec.ts`
- Modify: `helados-api/src/analytics/analytics.service.ts`

- [ ] **Step 1: Expand `mockPrisma` in the spec file**

Open `helados-api/src/analytics/analytics.service.spec.ts`. Replace the `mockPrisma` constant at the top of the file:

```typescript
const mockPrisma = {
  order:            { findMany: jest.fn(), count: jest.fn() },
  orderItem:        { groupBy: jest.fn(), count: jest.fn() },
  orderItemTopping: { groupBy: jest.fn() },
  orderPayment:     { groupBy: jest.fn() },
  flavor:           { findMany: jest.fn() },
  topping:          { findMany: jest.fn() },
};
```

- [ ] **Step 2: Write 3 failing tests for `getDaily`**

Add this `describe` block inside `describe('AnalyticsService', ...)`, after the existing `getTopItems` block:

```typescript
  describe('getDaily', () => {
    it('returns counts and revenue split for a day with mixed payments', async () => {
      mockPrisma.order.count.mockResolvedValue(5);
      mockPrisma.orderItem.count.mockResolvedValue(8);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([
        { paymentMethod: 'CASH', _sum: { amount: '40.00' } },
        { paymentMethod: 'QR',   _sum: { amount: '60.50' } },
      ]);

      const result = await service.getDaily('2026-06-15');

      expect(result.orders).toBe(5);
      expect(result.items).toBe(8);
      expect(result.cashRevenue).toBeCloseTo(40.00, 2);
      expect(result.qrRevenue).toBeCloseTo(60.50, 2);
      expect(result.totalRevenue).toBeCloseTo(100.50, 2);
    });

    it('returns all zeros for a day with no orders', async () => {
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.orderItem.count.mockResolvedValue(0);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([]);

      const result = await service.getDaily('2026-06-01');

      expect(result).toEqual({ orders: 0, items: 0, totalRevenue: 0, cashRevenue: 0, qrRevenue: 0 });
    });

    it('returns 0 cashRevenue when only QR payments were used', async () => {
      mockPrisma.order.count.mockResolvedValue(3);
      mockPrisma.orderItem.count.mockResolvedValue(4);
      mockPrisma.orderPayment.groupBy.mockResolvedValue([
        { paymentMethod: 'QR', _sum: { amount: '75.00' } },
      ]);

      const result = await service.getDaily('2026-06-15');

      expect(result.cashRevenue).toBe(0);
      expect(result.qrRevenue).toBeCloseTo(75.00, 2);
      expect(result.totalRevenue).toBeCloseTo(75.00, 2);
    });
  });
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
cd helados-api && npm test -- --testPathPattern=analytics.service
```

Expected: 3 failures like `TypeError: service.getDaily is not a function`. The pre-existing `getSummary` and `getTopItems` tests must still pass.

- [ ] **Step 4: Create the DTO**

Create `helados-api/src/analytics/dto/analytics-daily-query.dto.ts`:

```typescript
import { IsDateString } from 'class-validator';

export class AnalyticsDailyQueryDto {
  @IsDateString()
  date: string;
}
```

- [ ] **Step 5: Implement `getDaily` in the service**

Open `helados-api/src/analytics/analytics.service.ts`. Add the following method after `getTopItems`:

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

- [ ] **Step 6: Run tests — verify all pass**

```bash
cd helados-api && npm test -- --testPathPattern=analytics.service
```

Expected: all tests PASS (the 3 new + the 5 pre-existing).

- [ ] **Step 7: Commit**

```bash
git add helados-api/src/analytics/dto/analytics-daily-query.dto.ts \
        helados-api/src/analytics/analytics.service.ts \
        helados-api/src/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add getDaily service method with TDD tests"
```

---

## Task 2: Backend — Controller Route

**Files:**
- Modify: `helados-api/src/analytics/analytics.controller.ts`

- [ ] **Step 1: Add the route**

Open `helados-api/src/analytics/analytics.controller.ts`. Add the `AnalyticsDailyQueryDto` import and a new `@Get('daily')` handler. The final file should be:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsDailyQueryDto } from './dto/analytics-daily-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('summary')
  getSummary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getSummary(query.from, query.to);
  }

  @Get('top-items')
  getTopItems(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getTopItems(query.from, query.to);
  }

  @Get('daily')
  getDaily(@Query() query: AnalyticsDailyQueryDto) {
    return this.analytics.getDaily(query.date);
  }
}
```

- [ ] **Step 2: Run full backend test suite**

```bash
cd helados-api && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add helados-api/src/analytics/analytics.controller.ts
git commit -m "feat(analytics): add GET /analytics/daily route"
```

---

## Task 3: Frontend — Model + Service

**Files:**
- Modify: `helados-ui/src/app/core/models/analytics.model.ts`
- Modify: `helados-ui/src/app/core/services/analytics.service.ts`

- [ ] **Step 1: Add `DailyData` interface**

Open `helados-ui/src/app/core/models/analytics.model.ts`. Append at the end:

```typescript
export interface DailyData {
  orders:       number;
  items:        number;
  totalRevenue: number;
  cashRevenue:  number;
  qrRevenue:    number;
}
```

- [ ] **Step 2: Add `getDaily` to the frontend service**

Open `helados-ui/src/app/core/services/analytics.service.ts`. Update the import line to include `DailyData`, then add the method. Final file:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { DailyData, SummaryData, TopItemsData } from '../models/analytics.model';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/analytics`;

  getSummary(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<SummaryData>(`${this.url}/summary`, { params });
  }

  getTopItems(from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<TopItemsData>(`${this.url}/top-items`, { params });
  }

  getDaily(date: string) {
    const params = new HttpParams().set('date', date);
    return this.http.get<DailyData>(`${this.url}/daily`, { params });
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: build succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add helados-ui/src/app/core/models/analytics.model.ts \
        helados-ui/src/app/core/services/analytics.service.ts
git commit -m "feat(analytics): add DailyData model and getDaily frontend service method"
```

---

## Task 4: Frontend — DailyComponent

**Files:**
- Create: `helados-ui/src/app/features/analytics/daily/daily.component.ts`
- Create: `helados-ui/src/app/features/analytics/daily/daily.component.html`

- [ ] **Step 1: Create the component class**

Create `helados-ui/src/app/features/analytics/daily/daily.component.ts`:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DailyData } from '../../../core/models/analytics.model';

@Component({
  selector: 'app-daily',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './daily.component.html',
})
export class DailyComponent implements OnInit {
  private analytics = inject(AnalyticsService);

  dateA = '';
  dateB = '';
  dataA: DailyData | null = null;
  dataB: DailyData | null = null;
  loadingA = false;
  loadingB = false;
  errorA = '';
  errorB = '';
  comparing = false;

  ngOnInit() {
    this.dateA = new Date().toISOString().split('T')[0];
    this.loadA();
  }

  loadA() {
    if (!this.dateA) return;
    this.loadingA = true;
    this.errorA = '';
    this.dataA = null;
    this.analytics.getDaily(this.dateA).subscribe({
      next: (data) => { this.dataA = data; this.loadingA = false; },
      error: () => { this.errorA = 'No se pudo cargar'; this.loadingA = false; },
    });
  }

  loadB() {
    if (!this.dateB) return;
    this.loadingB = true;
    this.errorB = '';
    this.dataB = null;
    this.analytics.getDaily(this.dateB).subscribe({
      next: (data) => { this.dataB = data; this.loadingB = false; },
      error: () => { this.errorB = 'No se pudo cargar'; this.loadingB = false; },
    });
  }

  startComparing() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.dateB = yesterday.toISOString().split('T')[0];
    this.comparing = true;
    this.loadB();
  }

  stopComparing() {
    this.comparing = false;
    this.dateB = '';
    this.dataB = null;
    this.errorB = '';
  }

  formatPrice(n: number): string {
    return `$${Number(n).toFixed(2)}`;
  }
}
```

- [ ] **Step 2: Create the template**

Create `helados-ui/src/app/features/analytics/daily/daily.component.html`:

```html
<div class="min-h-screen bg-gray-950 p-5 space-y-6">

  <!-- Header -->
  <div class="flex items-center gap-4">
    <a routerLink="/dashboard" class="text-purple-400 hover:text-purple-300 text-sm">← Dashboard</a>
    <h1 class="text-2xl font-bold text-white">Análisis diario</h1>
  </div>

  <!-- Controls -->
  @if (!comparing) {
    <div class="flex items-center gap-3 flex-wrap">
      <input
        [(ngModel)]="dateA"
        type="date"
        class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      <button
        (click)="loadA()"
        class="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg font-medium touch-manipulation"
      >Cargar</button>
      <button
        (click)="startComparing()"
        class="ml-auto border border-dashed border-purple-700 text-purple-400 hover:text-purple-300 text-sm px-4 py-2 rounded-lg touch-manipulation"
      >+ Comparar con otro día</button>
    </div>
  } @else {
    <div class="flex items-center gap-4 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="text-gray-400 text-sm font-medium w-12">Día A</span>
        <input
          [(ngModel)]="dateA"
          type="date"
          class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          (click)="loadA()"
          class="bg-purple-600 hover:bg-purple-700 text-white text-sm px-3 py-2 rounded-lg touch-manipulation"
        >Cargar</button>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-gray-400 text-sm font-medium w-12">Día B</span>
        <input
          [(ngModel)]="dateB"
          type="date"
          class="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          (click)="loadB()"
          class="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg touch-manipulation"
        >Cargar</button>
      </div>
      <button
        (click)="stopComparing()"
        class="ml-auto text-gray-500 hover:text-gray-300 text-sm touch-manipulation"
      >✕ Quitar comparación</button>
    </div>
  }

  <!-- Single-day metrics -->
  @if (!comparing) {
    @if (loadingA) {
      <p class="text-gray-400">Cargando...</p>
    } @else if (errorA) {
      <p class="text-red-400">{{ errorA }}</p>
    } @else if (dataA) {
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-gray-900 rounded-2xl p-5">
          <p class="text-gray-400 text-sm">Pedidos</p>
          <p class="text-3xl font-bold text-white mt-1">{{ dataA.orders }}</p>
        </div>
        <div class="bg-gray-900 rounded-2xl p-5">
          <p class="text-gray-400 text-sm">Ítems</p>
          <p class="text-3xl font-bold text-white mt-1">{{ dataA.items }}</p>
        </div>
        <div class="bg-gray-900 rounded-2xl p-5">
          <p class="text-gray-400 text-sm">Total</p>
          <p class="text-3xl font-bold text-purple-400 mt-1">{{ formatPrice(dataA.totalRevenue) }}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-gray-900 rounded-2xl p-5">
          <p class="text-gray-400 text-sm">💵 Efectivo</p>
          <p class="text-3xl font-bold text-green-400 mt-1">{{ formatPrice(dataA.cashRevenue) }}</p>
        </div>
        <div class="bg-gray-900 rounded-2xl p-5">
          <p class="text-gray-400 text-sm">📱 QR</p>
          <p class="text-3xl font-bold text-purple-400 mt-1">{{ formatPrice(dataA.qrRevenue) }}</p>
        </div>
      </div>
    }
  }

  <!-- Comparison table -->
  @if (comparing) {
    <div class="bg-gray-900 rounded-2xl p-5">
      <div class="grid grid-cols-3 gap-4">

        <!-- Column headers -->
        <div></div>
        <div class="text-center text-sm font-semibold text-gray-300 pb-2 border-b border-gray-800">Día A</div>
        <div class="text-center text-sm font-semibold text-gray-300 pb-2 border-b border-gray-800">Día B</div>

        <!-- Pedidos -->
        <div class="text-gray-400 text-sm flex items-center py-3 border-b border-gray-800">Pedidos</div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingA) { <span class="text-gray-500">...</span> }
          @else if (errorA) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataA) { <span class="text-white font-bold text-xl">{{ dataA.orders }}</span> }
        </div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingB) { <span class="text-gray-500">...</span> }
          @else if (errorB) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataB) { <span class="text-white font-bold text-xl">{{ dataB.orders }}</span> }
          @else { <span class="text-gray-600">—</span> }
        </div>

        <!-- Ítems -->
        <div class="text-gray-400 text-sm flex items-center py-3 border-b border-gray-800">Ítems</div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingA) { <span class="text-gray-500">...</span> }
          @else if (errorA) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataA) { <span class="text-white font-bold text-xl">{{ dataA.items }}</span> }
        </div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingB) { <span class="text-gray-500">...</span> }
          @else if (errorB) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataB) { <span class="text-white font-bold text-xl">{{ dataB.items }}</span> }
          @else { <span class="text-gray-600">—</span> }
        </div>

        <!-- Total -->
        <div class="text-gray-400 text-sm flex items-center py-3 border-b border-gray-800">Total</div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingA) { <span class="text-gray-500">...</span> }
          @else if (errorA) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataA) { <span class="text-purple-400 font-bold text-xl">{{ formatPrice(dataA.totalRevenue) }}</span> }
        </div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingB) { <span class="text-gray-500">...</span> }
          @else if (errorB) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataB) { <span class="text-purple-400 font-bold text-xl">{{ formatPrice(dataB.totalRevenue) }}</span> }
          @else { <span class="text-gray-600">—</span> }
        </div>

        <!-- Efectivo -->
        <div class="text-gray-400 text-sm flex items-center py-3 border-b border-gray-800">💵 Efectivo</div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingA) { <span class="text-gray-500">...</span> }
          @else if (errorA) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataA) { <span class="text-green-400 font-bold text-xl">{{ formatPrice(dataA.cashRevenue) }}</span> }
        </div>
        <div class="text-center py-3 border-b border-gray-800">
          @if (loadingB) { <span class="text-gray-500">...</span> }
          @else if (errorB) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataB) { <span class="text-green-400 font-bold text-xl">{{ formatPrice(dataB.cashRevenue) }}</span> }
          @else { <span class="text-gray-600">—</span> }
        </div>

        <!-- QR -->
        <div class="text-gray-400 text-sm flex items-center py-3">📱 QR</div>
        <div class="text-center py-3">
          @if (loadingA) { <span class="text-gray-500">...</span> }
          @else if (errorA) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataA) { <span class="text-purple-400 font-bold text-xl">{{ formatPrice(dataA.qrRevenue) }}</span> }
        </div>
        <div class="text-center py-3">
          @if (loadingB) { <span class="text-gray-500">...</span> }
          @else if (errorB) { <span class="text-red-400 text-sm">Error</span> }
          @else if (dataB) { <span class="text-purple-400 font-bold text-xl">{{ formatPrice(dataB.qrRevenue) }}</span> }
          @else { <span class="text-gray-600">—</span> }
        </div>

      </div>
    </div>
  }

</div>
```

- [ ] **Step 3: Build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: build succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add helados-ui/src/app/features/analytics/daily/
git commit -m "feat(analytics): add DailyComponent with single-day and comparison modes"
```

---

## Task 5: Frontend — Routing + Dashboard Nav Link

**Files:**
- Modify: `helados-ui/src/app/app.routes.ts`
- Modify: `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts`
- Modify: `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html`

- [ ] **Step 1: Add the `/dashboard/daily` route**

Open `helados-ui/src/app/app.routes.ts`. Insert a new route object for `dashboard/daily` **before** the existing `dashboard` route. The relevant section should look like:

```typescript
  {
    path: 'dashboard/daily',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/analytics/daily/daily.component').then((m) => m.DailyComponent),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/analytics/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
```

- [ ] **Step 2: Add `RouterLink` import to dashboard component**

Open `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts`. Add `RouterLink` to the imports. Replace the existing `imports` line:

```typescript
import { RouterLink } from '@angular/router';
// ...
  imports: [CommonModule, FormsModule, RouterLink],
```

The full imports block at the top of the file becomes:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { SummaryData, TopItemsData } from '../../../core/models/analytics.model';
```

And the `@Component` decorator becomes:

```typescript
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.component.html',
})
```

- [ ] **Step 3: Add the "Ver análisis diario →" link in the dashboard header**

Open `helados-ui/src/app/features/analytics/dashboard/dashboard.component.html`. In the header `<div class="flex flex-wrap items-center gap-3">`, add the link immediately after the `<h1>`:

```html
  <div class="flex flex-wrap items-center gap-3">
    <h1 class="text-2xl font-bold text-white">Dashboard</h1>
    <a
      routerLink="/dashboard/daily"
      class="text-purple-400 hover:text-purple-300 text-sm border border-purple-800 px-3 py-2 rounded-lg touch-manipulation"
    >Ver análisis diario →</a>
    <div class="ml-auto flex items-center gap-2 flex-wrap">
```

- [ ] **Step 4: Build check**

```bash
cd helados-ui && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: build succeeds, no errors.

- [ ] **Step 5: Run full backend test suite one final time**

```bash
cd helados-api && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add helados-ui/src/app/app.routes.ts \
        helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts \
        helados-ui/src/app/features/analytics/dashboard/dashboard.component.html
git commit -m "feat(analytics): add /dashboard/daily route and nav link from dashboard"
```
