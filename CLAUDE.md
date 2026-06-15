# helados-app — Project Context for Claude

## What this is

Internal web app for an ice cream startup. Used by 4–5 staff members on a **tablet in landscape orientation**. Not a public-facing app — simplicity and touch-friendliness over complex UX.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Angular 18 (standalone components), Tailwind CSS |
| Backend | NestJS 11 + Prisma 5 + PostgreSQL |
| Images | Cloudinary (free tier) |
| Auth | JWT (8h expiry), stored in localStorage |
| Local dev | Docker Compose (PostgreSQL only) |
| Deployment | Neon (PostgreSQL), Railway (NestJS API), Vercel or Netlify (Angular static) |

## Running things

```bash
# Start local PostgreSQL
docker-compose up -d

# API (dev)
cd helados-api && npm run start:dev

# UI (dev)
cd helados-ui && npx ng serve

# API tests
cd helados-api && npm test

# Angular build check
cd helados-ui && npx ng build --configuration=development
```

**psql not in PATH on this machine** — use:
```bash
PGPASSWORD=helados /Library/PostgreSQL/17/bin/psql -U helados -d helados_dev
```

## Environment variables

`helados-api/.env` (gitignored):
```
DATABASE_URL=postgresql://helados:helados@localhost:5432/helados_dev
JWT_SECRET=dev-secret-change-in-production
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Angular uses `helados-ui/src/environments/environment.ts` (NOT `VITE_API_URL`).

## DB seed

One existing user: `Admin` / `admin@helados.com` / password: `admin1234` / role: `ADMIN`

Seed also upserts `ToppingTypeConfig` rows for NORMAL and PREMIUM (unitPrice defaults to 0).

## NestJS modules & routes

**Auth guard composition:**
- Class-level `@UseGuards(JwtAuthGuard)` → any authenticated user
- Method-level `@UseGuards(RolesGuard) @Roles('ADMIN')` → admin only
- `AuthModule` exports `[AuthService, RolesGuard]` (NOT JwtAuthGuard — it's not in providers)
- `PrismaModule` is `@Global()` — never import it in feature modules

| Module | Key routes |
|---|---|
| **AuthModule** | `POST /auth/login` (public), `POST /auth/change-password` (JWT) |
| **UsersModule** | `GET/POST /users`, `PATCH /users/:id/role`, `PATCH /users/:id/deactivate` — all ADMIN |
| **ProductsModule** | `GET /products` (any auth), `POST /products`, `PATCH /products/:id`, `PATCH /products/:id/toggle-active` — writes ADMIN |
| **FlavorsModule** | `GET /flavors` (any auth), writes ADMIN |
| **ToppingsModule** | `GET /toppings`, `GET /toppings/type-config` (any auth), `PATCH /toppings/type-config/:type`, writes ADMIN |
| **CouponsModule** | `POST /coupons/validate` (any auth), rest ADMIN; exports `CouponsService` |
| **ImagesModule** | `POST /images/upload` — ADMIN, 5 MB limit, uploads to Cloudinary |
| **OrdersModule** | `POST /orders`, `GET /orders`, `GET /orders/:id` — any auth; uses `CouponsService` |
| **InventoryModule** | `POST/GET /inventory/snapshots`, `GET /inventory/snapshots/day`, `PATCH /inventory/snapshots/:id` — all ADMIN |
| **AnalyticsModule** | `GET /analytics/summary`, `GET /analytics/top-items` — both ADMIN, support `from`/`to` query params |

**Catalog read vs. write access:**
- `GET /products|flavors|toppings` — any authenticated user (staff need it for orders)
- `POST/PATCH` — ADMIN only

**Email normalization:**
- Always `.toLowerCase()` before `findUnique` and `create` — PostgreSQL is case-sensitive

**Coupon validation:**
- Returns `UnprocessableEntityException` (422) — NOT 400
- All failure messages are in Spanish

## Prisma schema — enums & models

**Enums:** `Role` (STAFF, ADMIN), `ProductType` (CONE, CONTAINER, CUP, BOWL, DRINK), `ProductSize` (SMALL, MEDIUM, LARGE), `DiscountType` (PERCENTAGE, FIXED), `ToppingType` (NORMAL, PREMIUM), `SnapshotPeriod` (MORNING, NIGHT), `PaymentMethod` (QR, CASH)

**Key models:**

| Model | Notable fields |
|---|---|
| `User` | name, email (unique), passwordHash, role, active |
| `Product` | type, size, basePrice, directSale, includedToppingType (ToppingType?), includedToppingQty (Int?) |
| `Flavor` | name, priceModifier, imageUrl, active |
| `ToppingTypeConfig` | type (PK), unitPrice — stores default price for NORMAL/PREMIUM |
| `Topping` | name, type (ToppingType), customPrice (nullable override), unitPrice (computed/stored), active |
| `Coupon` | code (unique), discountType, discountValue, maxUses, usesCount, validFrom, validUntil, active |
| `Order` | staffId, couponId, paymentMethod, subtotal, discountAmount, totalAmount, notes |
| `OrderItem` | productId, flavorId (nullable for directSale), itemTotal |
| `OrderItemTopping` | toppingId, quantity, **unitPriceAtSale** (price snapshot at time of sale) |
| `InventorySnapshot` | takenBy, takenAt, period (MORNING/NIGHT), notes |
| `InventoryLine` | snapshotId, productId (nullable), label (nullable), quantity |
| `InventoryEdit` | snapshotId, editedBy, editedAt, reason — audit log for edits |

**Product topping allowance:**
- `includedToppingType` + `includedToppingQty` are co-present (both set or both null)
- Orders service applies a `remainingFree` counter per item — matching-type toppings are free up to qty, overflow charged at full `unitPrice`
- Frontend (`new-order.component.ts`) mirrors this logic to show correct price preview

**Direct-sale products:**
- `directSale: true` → no flavor, no toppings — added straight to cart at basePrice
- Orders service validates and rejects flavor/topping on direct-sale items

## Angular patterns

- `inject()` function DI (no constructor injection)
- Functional interceptor: `HttpInterceptorFn` — adds JWT Bearer, 401 → `auth.logout()`, 403 → navigate `/orders/new`
- Functional guards: `CanActivateFn` — `authGuard` (logged in), `adminGuard` (role=ADMIN)
- Brand purple: `purple-600` (#9333ea), `purple-700` (#7e22ce)
- Dark theme: `gray-950` backgrounds, `gray-900` cards

## Angular routes & features

| Route | Guard | Component |
|---|---|---|
| `/login` | none | `LoginComponent` |
| `/orders/new` | authGuard | `NewOrderComponent` — 5-step order flow (product → flavor → toppings → coupon → review+payment) |
| `/orders/history` | authGuard | `OrderHistoryComponent` — list with date range filter |
| `/dashboard` | authGuard + adminGuard | `DashboardComponent` — revenue summary + top items |
| `/inventory` | authGuard + adminGuard | `InventoryComponent` — snapshot pairs (morning/night), edit with audit log |
| `/catalog` | authGuard + adminGuard | `CatalogComponent` — tabbed: Products / Flavors / Toppings (includes type config prices) |
| `/coupons` | authGuard + adminGuard | `CouponsComponent` |
| `/users` | authGuard + adminGuard | `UsersComponent` |

## Development workflow

- Feature branches use git worktrees under `.worktrees/` (gitignored)
- Plans live in `docs/superpowers/plans/`
- Specs live in `docs/superpowers/specs/`
- Development follows: subagent implements → spec compliance review → code quality review → mark done

## Plan roadmap

| Plan | Status | Covers |
|---|---|---|
| 1 | ✅ Done | Foundation, Auth, Login UI |
| 2 | ✅ Done | Catalog CRUD, Users, Coupons, Cloudinary, Angular pages |
| 3 | ✅ Done | Visual 5-step order flow, NestJS OrdersModule, order history |
| 4 | ✅ Done | Inventory snapshots (upsert), analytics dashboard |
| — | ✅ Done | `unitPriceAtSale` on OrderItemTopping (price snapshot fix) |
| — | ✅ Done | Per-product topping allowance (includedToppingType/Qty), frontend+backend |
