# Helados App — Design Spec
_Date: 2026-06-12_

## Overview

An internal web application for an ice cream startup. Used by 4–5 staff members (not all concurrent) on a **tablet in landscape orientation** at the counter. The app covers three core needs: recording sales orders visually, tracking inventory morning vs. night, and providing analytics to the admin.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 18 + Tailwind CSS |
| Backend | NestJS (TypeScript) |
| Database | PostgreSQL + Prisma ORM |
| Image storage | Cloudinary (free tier) |
| Local dev | Docker Compose (Angular dev server + NestJS + PostgreSQL) |
| Deploy — DB | Neon (managed serverless PostgreSQL) |
| Deploy — API | Railway |
| Deploy — Frontend | Vercel or Netlify (static Angular build) |

---

## Roles

| Role | Access |
|---|---|
| **STAFF** | New Order, Order History |
| **ADMIN** | Everything staff can do + Dashboard, Inventory, Catalog, Coupons, Users |

Authentication is JWT-based. Each user has an individual account (email + password). Token stored in `localStorage` on the frontend; sent as `Authorization: Bearer` header on every API request. NestJS guards enforce role-based access per route.

---

## Data Model

### users
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar | |
| email | varchar UNIQUE | |
| password_hash | varchar | bcrypt |
| role | enum | STAFF \| ADMIN |
| active | boolean | logical delete |
| created_at | timestamp | |

### products
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar | e.g. "Small Cone" |
| type | enum | CONE \| CONTAINER \| CUP \| BOWL |
| size | enum | SMALL \| MEDIUM \| LARGE |
| base_price | decimal(10,2) | |
| image_url | varchar | Cloudinary URL |
| active | boolean | soft delete — preserves order history |
| created_at | timestamp | |

### flavors
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar | |
| price_modifier | decimal(10,2) | added to base_price (can be 0) |
| image_url | varchar | Cloudinary URL |
| active | boolean | |

### toppings
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | varchar | |
| unit_price | decimal(10,2) | per unit added |
| image_url | varchar | Cloudinary URL |
| active | boolean | |

### coupons
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | varchar UNIQUE | case-insensitive lookup |
| discount_type | enum | PERCENTAGE \| FIXED |
| discount_value | decimal(10,2) | % or currency amount |
| max_uses | int | nullable = unlimited |
| uses_count | int | default 0 |
| valid_from | date | nullable |
| valid_until | date | nullable |
| active | boolean | |

### orders
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| staff_id | uuid FK → users | who logged the order |
| coupon_id | uuid FK → coupons | nullable |
| created_at | timestamp | |
| subtotal | decimal(10,2) | before discount |
| discount_amount | decimal(10,2) | 0 if no coupon |
| total_amount | decimal(10,2) | subtotal − discount |
| notes | text | nullable |

### order_items
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| order_id | uuid FK → orders | |
| product_id | uuid FK → products | snapshot of product at time of sale |
| flavor_id | uuid FK → flavors | |
| item_total | decimal(10,2) | base_price + price_modifier — locked at order time, unaffected by future price changes |

### order_item_toppings
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| order_item_id | uuid FK → order_items | |
| topping_id | uuid FK → toppings | |
| quantity | int | |

### inventory_snapshots
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| taken_by | uuid FK → users | admin only |
| taken_at | timestamp | |
| period | enum | MORNING \| NIGHT |
| notes | text | nullable |

### inventory_lines
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| snapshot_id | uuid FK → inventory_snapshots | |
| ref_type | enum | FLAVOR \| TOPPING |
| ref_id | uuid | FK to flavors or toppings |
| quantity | decimal(10,2) | units in stock at time of snapshot |

---

## Screens

### Shared
- **Login** — email + password, redirects by role on success
- **Profile** — change own password

### Staff

#### New Order (main screen)
Step-by-step, full-screen on tablet (landscape). No scrolling within a step — all choices visible at once.

1. **Product** — image card grid (type + size). Tap to select. Multiple items per order supported via "Add another item" button.
2. **Flavor** — image card grid of active flavors. Tap to select one per item.
3. **Toppings** — image card grid, multi-select. Tap toggles on/off. Quantity defaults to 1 (tap again to increment).
4. **Coupon** — optional text input for coupon code. NestJS validates: active, within date range, uses_count < max_uses. Discount shown immediately on valid code.
5. **Confirm** — order summary (items, toppings, subtotal, discount, total). "Place Order" button saves to DB.

Price is calculated automatically: `item_total = base_price + flavor.price_modifier`, `subtotal = Σ item_totals + Σ (topping.unit_price × quantity)`, `total = subtotal − discount_amount`.

#### Order History
- List of orders, default filter: today. Can filter by date range.
- Each row: timestamp, staff name, items summary, coupon used, total.
- Read-only for staff. Tap a row to expand full detail.

### Admin

#### Dashboard
- Date range selector (today / this week / this month / custom).
- KPI cards: total revenue, total orders, average order value, total discount given.
- Charts: revenue over time (line), top 5 toppings by quantity sold (bar), top products by revenue (bar).
- Gross vs. net revenue comparison (shows impact of coupons).

#### Inventory
- Admin selects period (MORNING or NIGHT) and confirms date.
- Entry form: one row per active flavor and topping with a quantity input. Submit saves snapshot.
- **Comparison view**: side-by-side morning vs. night for the same date. Delta column (morning − night). Estimated earnings column (delta × unit_price). Total estimated earnings at bottom.
- Export button: download comparison as PDF or CSV.

#### Catalog
Three tabs: Products, Flavors, Toppings.

Each tab:
- Grid of cards showing current items (image, name, price, active/inactive badge).
- **Create** — form: name, type/size (products), price, image upload (sent to Cloudinary, URL saved).
- **Edit** — same form, pre-filled.
- **Logical delete** — toggle active/inactive. Inactive items hidden from order screen but preserved in historical orders.

#### Coupons
- Table of all coupons: code, type, value, uses/max, valid dates, status.
- **Create** — code, discount type, value, optional max uses, optional date range.
- **Deactivate** — sets `active = false`.

#### Users
- Table of user accounts: name, email, role, status.
- **Create** — name, email, role, temporary password (user should change on first login).
- **Change role** — STAFF ↔ ADMIN.
- **Deactivate** — sets `active = false` (logical delete, preserves order attribution).

---

## API Design (NestJS)

Modules: `auth`, `users`, `products`, `flavors`, `toppings`, `coupons`, `orders`, `inventory`, `catalog-images`.

Key endpoints:

```
POST   /auth/login
POST   /auth/change-password

GET    /products          (active only for staff, all for admin)
POST   /products          (admin)
PATCH  /products/:id      (admin)
PATCH  /products/:id/toggle-active  (admin)

GET    /flavors
POST   /flavors           (admin)
PATCH  /flavors/:id       (admin)
PATCH  /flavors/:id/toggle-active   (admin)

GET    /toppings
POST   /toppings          (admin)
PATCH  /toppings/:id      (admin)
PATCH  /toppings/:id/toggle-active  (admin)

POST   /coupons           (admin)
GET    /coupons           (admin)
PATCH  /coupons/:id/deactivate      (admin)
POST   /coupons/validate  (staff — checks code, returns discount info)

POST   /orders
GET    /orders            (query: date range, paginated)
GET    /orders/:id

POST   /inventory/snapshots         (admin)
GET    /inventory/snapshots         (admin — filter by date)
GET    /inventory/compare?date=     (admin — returns morning + night side by side)

GET    /analytics/dashboard         (admin — query: from, to)

POST   /images/upload     (admin — multipart, returns Cloudinary URL)
```

---

## Error Handling

- NestJS global exception filter returns consistent `{ statusCode, message, error }` shape.
- Angular HTTP interceptor catches 401 (token expired → redirect to login) and 403 (show "Access denied" toast).
- Coupon validation errors (expired, exhausted, invalid) returned as 422 with a human-readable message shown inline on the order screen.
- Image upload failures shown as a toast; catalog item is not saved until upload succeeds.

---

## Testing

- **NestJS:** unit tests for price calculation logic and coupon validation. Integration tests for order creation and inventory comparison endpoints (using a test PostgreSQL container via Docker).
- **Angular:** component tests for the order flow (product selection, topping multi-select, coupon code input, total calculation display).
- No E2E tests in v1 — the team is small and manual tablet testing is sufficient for the initial release.

---

## Deployment Notes

- Environment variables: `DATABASE_URL` (Neon connection string), `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Angular build output (`dist/`) deployed as static files to Vercel/Netlify. `environment.apiUrl` (set via Angular `environment.prod.ts`) points to Railway NestJS URL.
- Neon free tier: 0.5 GB storage — sufficient for this scale indefinitely.
- Railway free tier: 500 hours/month — sufficient for low-traffic internal tool.
- Add `.superpowers/` to `.gitignore`.
