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

## NestJS architectural patterns

**Auth guard composition:**
- Class-level: `@UseGuards(JwtAuthGuard)` → any authenticated user
- Method-level: `@UseGuards(RolesGuard) @Roles('ADMIN')` → admin only
- `AuthModule` exports `[AuthService, RolesGuard]` (NOT JwtAuthGuard — it's not in providers)
- PrismaModule is `@Global()` — never import it in feature modules

**Catalog read vs. write access:**
- `GET /products|flavors|toppings` — any authenticated user (staff need it for orders)
- `POST/PATCH` — ADMIN only

**Email normalization:**
- Always `.toLowerCase()` before `findUnique` and `create` — PostgreSQL is case-sensitive

**Coupon validation:**
- Returns `UnprocessableEntityException` (422) — NOT 400
- All failure messages are in Spanish
- `CouponsModule` exports `CouponsService` (Plan 3 orders reuse it)

## Angular patterns

- `inject()` function DI (no constructor injection)
- Functional interceptor: `HttpInterceptorFn`
- Functional guards: `CanActivateFn`
- 401 response → `auth.logout()` (interceptor)
- 403 response → navigate to `/orders/new` (interceptor)
- Brand purple: `purple-600` (#9333ea), `purple-700` (#7e22ce)
- Dark theme: `gray-950` backgrounds, `gray-900` cards

## DB seed

One existing user: `Admin` / `admin@helados.com` / password: `admin` / role: `ADMIN`

## Development workflow

- Feature branches use git worktrees under `.worktrees/` (gitignored)
- Plans live in `docs/superpowers/plans/`
- Specs live in `docs/superpowers/specs/`
- Development follows: subagent implements → spec compliance review → code quality review → mark done

## Plan roadmap

| Plan | Branch | Status | Covers |
|---|---|---|---|
| 1 | main (merged) | ✅ Done | Foundation, Auth, Login UI |
| 2 | `plan-2-catalog` | ✅ Done | Catalog CRUD, Users, Coupons, Cloudinary, Angular pages |
| 3 | `plan-3-orders` | ✅ Done | Visual 5-step order flow, NestJS OrdersModule, order history |
| 4 | TBD | Not started | Inventory snapshots, analytics dashboard |
