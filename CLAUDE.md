# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal web app for an ice cream startup (`helados-app`). Used by 4–5 staff members on a **tablet in landscape orientation**. Not a public-facing app — simplicity and touch-friendliness over complex UX. UI copy and API error messages are in **Spanish**.

Two apps in one repo: `helados-api/` (NestJS + Prisma) and `helados-ui/` (Angular 18). `README.md` is the Spanish-language equivalent of this document.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Angular 18 (standalone components, lazy `loadComponent` routes), Tailwind CSS |
| Backend | NestJS 11 + Prisma 5 + PostgreSQL |
| Images | Cloudinary (free tier) |
| Auth | JWT (8h expiry), stored in localStorage |
| Local dev | Docker Compose (postgres + optional api/ui services) |
| Deployment | Neon (PostgreSQL), Railway (NestJS API), Vercel or Netlify (Angular static) |

## Running things

```bash
cp .env.example .env && cp helados-api/.env.example helados-api/.env   # first run only
docker-compose up -d postgres      # DB only (the usual local setup)
docker-compose up -d               # full stack: postgres + api + ui via Dockerfile.dev

cd helados-api && npm run start:dev     # API on :3000
cd helados-ui && npx ng serve           # UI on :4200
```

```bash
cd helados-api
npm test                                        # full Jest suite
npm test -- orders.service.spec.ts              # single spec file
npm test -- -t "nombre del caso"                # single test by name
npm run test:cov
npm run lint                                    # eslint --fix
npm run prisma:migrate                          # prisma migrate dev
npm run prisma:seed
npm run prisma:studio
```

**Frontend has no unit tests in practice** — validate Angular changes with a build:

```bash
cd helados-ui && npx ng build --configuration=development
```

**psql not in PATH on this machine** — the full binary path is `/Library/PostgreSQL/17/bin/psql`; connection details are in the gitignored `CREDENCIALES.local.md`.

## Environment variables

**This repo is public — never write real credential values into any tracked file.** Templates only.

- `helados-api/.env` (gitignored) — keys documented in `helados-api/.env.example`: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `CLOUDINARY_*`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
- `.env` at repo root (gitignored) — consumed by `docker-compose.yml`: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`. Compose uses `${VAR:?}` so it fails loudly if the file is missing.
- `CREDENCIALES.local.md` (gitignored) — human-readable list of the local dev credentials

`PORT` (default 3000) and `FRONTEND_URL` (CORS origin, default `http://localhost:4200`) are read in `main.ts`.

Angular reads `apiUrl` from `helados-ui/src/environments/environment.ts` / `environment.prod.ts` (NOT `VITE_API_URL`). Prod points at the Railway API.

## DB seed

Creates one `ADMIN` user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The seed **throws** if `SEED_ADMIN_PASSWORD` is unset — no default password is hardcoded. Local values are in `CREDENCIALES.local.md`.

Seed also upserts `ToppingTypeConfig` rows for NORMAL and PREMIUM (unitPrice defaults to 0).

## NestJS modules & routes

**Auth guard composition:**
- Class-level `@UseGuards(JwtAuthGuard)` → any authenticated user
- Method-level `@UseGuards(RolesGuard) @Roles('ADMIN')` → admin only
- `AuthModule` exports `[AuthService, RolesGuard]` (NOT JwtAuthGuard — it's not in providers)
- `PrismaModule` is `@Global()` — never import it in feature modules
- Global `ValidationPipe({ whitelist: true })` — unlisted DTO properties are silently stripped

| Module | Key routes |
|---|---|
| **AuthModule** | `POST /auth/login` (public), `POST /auth/change-password` (JWT) |
| **UsersModule** | `GET/POST /users`, `PATCH /users/:id/role`, `PATCH /users/:id/deactivate` — all ADMIN |
| **ProductsModule** | `GET /products` (any auth), `POST /products`, `PATCH /products/:id`, `PATCH /products/:id/toggle-active` — writes ADMIN |
| **FlavorsModule** | `GET /flavors` (any auth), writes ADMIN |
| **ToppingsModule** | `GET /toppings`, `GET /toppings/type-config` (any auth), `PATCH /toppings/type-config/:type`, writes ADMIN |
| **CouponsModule** | `POST /coupons/validate` (any auth), rest ADMIN; exports `CouponsService` |
| **ImagesModule** | `POST /images/upload` — ADMIN, 5 MB limit, uploads to Cloudinary |
| **OrdersModule** | `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/cancel` — any auth; uses `CouponsService` |
| **InventoryModule** | `POST/GET /inventory/snapshots`, `GET /inventory/snapshots/day`, `PATCH /inventory/snapshots/:id` — all ADMIN |
| **AnalyticsModule** | `GET /analytics/summary`, `/top-items`, `/reconciliation-summary` (all take `from`/`to`); `GET /analytics/daily`, `/reconciliation` (take `date`); `PUT /analytics/reconciliation` — all ADMIN |

**Catalog read vs. write access:**
- `GET /products|flavors|toppings` — any authenticated user (staff need it for orders)
- `POST/PATCH` — ADMIN only

**Email normalization:**
- Always `.toLowerCase()` before `findUnique` and `create` — PostgreSQL is case-sensitive

**Coupon validation:**
- Returns `UnprocessableEntityException` (422) — NOT 400
- All failure messages are in Spanish

## Prisma schema — enums & models

**Enums:** `Role` (STAFF, ADMIN), `ProductType` (CONE, CONTAINER, BEVERAGE), `ProductSize` (SMALL, MEDIUM, LARGE, OZ4–OZ8), `DiscountType` (PERCENTAGE, FIXED), `ToppingType` (NORMAL, PREMIUM), `SnapshotPeriod` (MORNING, NIGHT), `PaymentMethod` (QR, CASH), `CancelReason` (REGISTRO_ERRONEO, CLIENTE_CANCELO, PRODUCTO_DEFECTUOSO, OTRO)

All money columns are `Decimal(10,2)` — Prisma returns `Decimal` objects, so wrap in `Number(...)` before arithmetic (the services do this consistently).

| Model | Notable fields |
|---|---|
| `User` | name, email (unique), passwordHash, role, active |
| `Product` | type, size (nullable), basePrice, directSale, includedToppingType (ToppingType?), includedToppingQty (Int?) |
| `Flavor` | name, priceModifier, imageUrl, active |
| `ToppingTypeConfig` | type (PK), unitPrice — default price for NORMAL/PREMIUM |
| `Topping` | name, type, customPrice (nullable override), unitPrice (computed/stored), active |
| `Coupon` | code (unique), discountType, discountValue, maxUses, usesCount, validFrom, validUntil, active |
| `Order` | staffId, couponId, subtotal, discountAmount, totalAmount, notes, cancelledAt, cancelledBy, cancelReason — **no paymentMethod column** |
| `OrderPayment` | orderId, paymentMethod, amount — 1–2 rows per order (split payments) |
| `OrderItem` | productId, flavorId (nullable for directSale), itemTotal |
| `OrderItemTopping` | toppingId, quantity, **unitPriceAtSale** (price snapshot at time of sale) |
| `InventorySnapshot` | takenBy, takenAt, period (MORNING/NIGHT), notes |
| `InventoryLine` | snapshotId, **productType/productSize** (type+size grouping), productId (nullable), label (nullable), quantity (Decimal) |
| `InventoryEdit` | snapshotId, editedBy, editedAt, reason — audit log for edits |
| `DailyReconciliation` | date (unique, `@db.Date`), actualCash, actualQr, updatedBy, updatedAt |

**Product topping allowance:**
- `includedToppingType` + `includedToppingQty` are co-present (both set or both null)
- Orders service applies a `remainingFree` counter per item — matching-type toppings are free up to qty, overflow charged at full `unitPrice`
- Frontend (`new-order.component.ts`) mirrors this logic to show correct price preview

**Direct-sale products:**
- `directSale: true` → no flavor, no toppings — added straight to cart at basePrice
- Orders service validates and rejects flavor/topping on direct-sale items

**Split payments:**
- `CreateOrderDto.payments` is 1–2 entries; duplicate methods → 400
- Payment sum must equal the order total **compared in integer cents** (`Math.round(x * 100)`) — mismatch → 422

**Order cancellation (soft void):**
- `cancelledAt IS NULL` means active — there is no `status` field
- ADMIN cancels anything; STAFF only their own orders within `CANCEL_WINDOW_MS` (15 min)
- Refusals are **422**, not 403 — the Angular interceptor redirects on any 403
- 8 of the 10 order read sites filter via `activeOrder()` / `activeOrderRelation()` in `src/orders/order-filters.ts`; the 2 in `orders.service.ts` stay unfiltered so history shows cancelled orders
- `canCancel` is computed server-side per order — do not reimplement the window rule in the frontend

**Inventory snapshots:**
- `POST /inventory/snapshots` is an **upsert** keyed on (date, period), inside a `$transaction`: existing lines and edits are deleted and recreated
- `PATCH` likewise replaces all lines and appends an `InventoryEdit` row with the reason

**Cash reconciliation:**
- `DailyReconciliation` stores what was *actually* counted; analytics compares it against system-recorded `OrderPayment` totals per method

## Angular patterns

- `inject()` function DI (no constructor injection)
- Functional interceptor: `HttpInterceptorFn` — adds JWT Bearer, 401 → `auth.logout()`, 403 → navigate `/orders/new`
- Functional guards: `CanActivateFn` — `authGuard` (logged in), `adminGuard` (role=ADMIN)
- One service per API area in `core/services/`, matching interfaces in `core/models/`
- Feature components live in `features/<area>/<page>/`; only shared piece is `shared/components/image-upload`
- Brand purple: `purple-600` (#9333ea), `purple-700` (#7e22ce)
- Dark theme: `gray-950` backgrounds, `gray-900` cards

## Angular routes & features

| Route | Guard | Component |
|---|---|---|
| `/login` | none | `LoginComponent` |
| `/orders/new` | authGuard | `NewOrderComponent` — 5-step order flow (product → flavor → toppings → coupon → review+payment) |
| `/orders/history` | authGuard | `OrderHistoryComponent` — list with date range filter |
| `/dashboard` | authGuard + adminGuard | `DashboardComponent` — revenue summary, top items, reconciliation comparison |
| `/dashboard/daily` | authGuard + adminGuard | `DailyComponent` — single-day analysis and day-vs-day comparison |
| `/inventory` | authGuard + adminGuard | `InventoryComponent` — snapshot pairs (morning/night), edit with audit log |
| `/catalog` | authGuard + adminGuard | `CatalogComponent` — tabbed: Products / Flavors / Toppings (includes type config prices) |
| `/coupons` | authGuard + adminGuard | `CouponsComponent` |
| `/users` | authGuard + adminGuard | `UsersComponent` |

Note `dashboard/daily` is declared **before** `dashboard` in `app.routes.ts` — keep that order.

## Development workflow

- Feature branches use git worktrees under `.worktrees/` (gitignored)
- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/` — both dated `YYYY-MM-DD-<slug>.md`. Write the spec first, then the plan, then implement.
- Development follows: subagent implements → spec compliance review → code quality review → mark done
- Schema changes go through `npm run prisma:migrate` (named migrations, committed under `prisma/migrations/`)

## Plan roadmap

| Plan | Status | Covers |
|---|---|---|
| 1 | ✅ Done | Foundation, Auth, Login UI |
| 2 | ✅ Done | Catalog CRUD, Users, Coupons, Cloudinary, Angular pages |
| 3 | ✅ Done | Visual 5-step order flow, NestJS OrdersModule, order history |
| 4 | ✅ Done | Inventory snapshots (upsert), analytics dashboard |
| — | ✅ Done | `unitPriceAtSale` on OrderItemTopping (price snapshot fix) |
| — | ✅ Done | Per-product topping allowance (includedToppingType/Qty), frontend+backend |
| — | ✅ Done | Split payments (`OrderPayment`, up to 2 methods per order) |
| — | ✅ Done | Inventory product-type redesign (type/size lines) |
| — | ✅ Done | Daily analytics (`/dashboard/daily`) |
| — | ✅ Done | Cash reconciliation + dashboard reconciliation comparison |
| — | ✅ Done | Order cancellation (soft void) with audit trail |
