# Inventory & Product Types Refactor Design Spec

**Date:** 2026-06-16
**Status:** Approved for implementation

---

## Goal

Replace the bloated product-type/size enums with a lean 3-type model (Cone, Container, Beverage), map packaging inventory to physical `(type, size)` assets instead of individual products, and give Beverage products a 1:1 inventory line with a sold-count overlay derived from order history.

---

## Section 1: Data Model

### ProductType enum

Remove `CUP`, `BOWL`, `DRINK`. Final values:

```prisma
enum ProductType {
  CONE
  CONTAINER
  BEVERAGE
}
```

### ProductSize enum

Add oz values for container sizes. `SMALL/MEDIUM/LARGE` remain for cones. Final values:

```prisma
enum ProductSize {
  SMALL
  MEDIUM
  LARGE
  OZ4
  OZ5
  OZ6
  OZ7
  OZ8
}
```

### Product.size — make nullable

`size` becomes `ProductSize?` (null for BEVERAGE products).

Valid combinations enforced at DTO/service level:

| ProductType | Valid sizes |
|-------------|-------------|
| CONE | SMALL, MEDIUM, LARGE |
| CONTAINER | OZ4, OZ5, OZ6, OZ7, OZ8 |
| BEVERAGE | null (no size) |

### InventoryLine — three modes

Remove the exclusive reliance on `productId`. Add `productType` and `productSize` columns. The `product` relation stays (used for BEVERAGE lines). Exactly one mode is populated per line:

| Mode | Columns populated | Used for |
|------|-------------------|----------|
| Packaging | `productType + productSize` | CONE/CONTAINER physical items |
| Beverage | `productId` | Each BEVERAGE product, 1:1 |
| Free-form | `label` | Syrups, napkins, other manual items |

```prisma
model InventoryLine {
  id           String        @id @default(uuid())
  snapshotId   String
  snapshot     InventorySnapshot @relation(fields: [snapshotId], references: [id])
  productType  ProductType?
  productSize  ProductSize?
  productId    String?
  product      Product?      @relation(fields: [productId], references: [id])
  label        String?
  quantity     Decimal       @db.Decimal(10, 2)
}
```

### Migration strategy

All existing product, order, topping, coupon, and inventory data is wiped (users are preserved). The migration:
1. Drops removed `ProductType` enum values (`CUP`, `BOWL`, `DRINK`)
2. Adds new `ProductSize` enum values (`OZ4`–`OZ8`)
3. Makes `Product.size` nullable
4. Adds `productType ProductType?` and `productSize ProductSize?` columns to `InventoryLine`

---

## Section 2: Backend

### Product validation (`create-product.dto.ts`)

- `type`: `@IsEnum(['CONE', 'CONTAINER', 'BEVERAGE'])`
- `size`: optional (`@IsOptional()`), validated cross-field:
  - CONE → must be one of `SMALL, MEDIUM, LARGE`
  - CONTAINER → must be one of `OZ4, OZ5, OZ6, OZ7, OZ8`
  - BEVERAGE → must be absent/null

### Product service

BEVERAGE products always have `directSale = true` — enforced in `products.service.ts` on create and update (override any DTO value).

### Snapshot creation (`inventory.service.ts`)

`createSnapshot` pre-populates lines in order:

1. **CONE packaging** — 3 lines with `productType=CONE`, `productSize` in `[SMALL, MEDIUM, LARGE]`, `quantity=0`
2. **CONTAINER packaging** — 5 lines with `productType=CONTAINER`, `productSize` in `[OZ4, OZ5, OZ6, OZ7, OZ8]`, `quantity=0`
3. **Active BEVERAGE products** — 1 line per product keyed by `productId`, `quantity=0`

Admin fills in quantities. No lines are created from the upsert payload that don't match an existing pre-populated slot (free-form label lines are the only addable type).

### Beverage sold-count overlay

When fetching a snapshot (`GET /inventory/snapshots/:id` or `GET /inventory/snapshots/day`), the service computes for each BEVERAGE line:

```
soldSince = COUNT of OrderItem where:
              OrderItem.productId = line.productId
              AND Order.createdAt >= snapshot.takenAt
remaining = line.quantity − soldSince
```

The API response for BEVERAGE lines includes extra fields:
```typescript
{
  ...line,
  soldSince: number,   // units sold since snapshot
  remaining: number,   // quantity − soldSince
}
```

No inventory writes occur at order time — the overlay is computed on read.

### Tests

- `products.service.spec.ts`: add cross-field size validation tests; test BEVERAGE auto-sets `directSale=true`
- `inventory.service.spec.ts`: update fixtures to use `productType/productSize`; add test for `soldSince` calculation

---

## Section 3: Frontend — Catalog

### Product type options

`productTypes` array: `['CONE', 'CONTAINER', 'BEVERAGE']`

### Size picker — conditional on type

```typescript
get availableSizes(): ProductSize[] {
  if (this.form.type === 'CONE')      return ['SMALL', 'MEDIUM', 'LARGE'];
  if (this.form.type === 'CONTAINER') return ['OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'];
  return []; // BEVERAGE — hidden
}
```

Size picker is hidden when `availableSizes` is empty. When type changes, `form.size` resets to `null`.

### BEVERAGE product form

- "Venta directa" toggle hidden (auto-set to true server-side)
- Flavor allowance and topping allowance fields hidden
- `size` not submitted in payload

### Display labels

Shared label map used everywhere type/size values are displayed:

```typescript
const TYPE_LABELS: Record<string, string> = {
  CONE: 'Cono', CONTAINER: 'Envase', BEVERAGE: 'Bebida',
};
const SIZE_LABELS: Record<string, string> = {
  SMALL: 'Pequeño', MEDIUM: 'Mediano', LARGE: 'Grande',
  OZ4: '4 oz', OZ5: '5 oz', OZ6: '6 oz', OZ7: '7 oz', OZ8: '8 oz',
};
```

Used in: catalog list, product badge on new-order cards, inventory labels.

---

## Section 4: Frontend — Inventory

### Line grouping

Snapshot lines are displayed in three sections:

1. **Conos** — 3 lines: Pequeño / Mediano / Grande
2. **Envases** — 5 lines: 4 oz / 5 oz / 6 oz / 7 oz / 8 oz
3. **Bebidas** — one line per active BEVERAGE product

Free-form label lines appear below in an "Otros" section.

### Packaging lines (Conos / Envases)

Unchanged behavior — admin enters a quantity, no overlay.

### Beverage lines

Display three values alongside the editable initial quantity:

```
Agua Cristal    [24]  −8 vendidas  =  16 restantes
```

- `[24]` — editable `quantity` field (initial stock entered by admin)
- `−8 vendidas` — `soldSince` from API (read-only)
- `16 restantes` — `remaining` from API, highlighted:
  - > 3 → green
  - 1–3 → amber
  - 0 → red

### Angular model update

```typescript
export interface InventoryLineResponse {
  id: string;
  productType: string | null;
  productSize: string | null;
  productId: string | null;
  product: { id: string; name: string; type: string } | null;
  label: string | null;
  quantity: number;
  soldSince?: number;   // BEVERAGE lines only
  remaining?: number;   // BEVERAGE lines only
}
```

### New-order product cards

BEVERAGE products appear in Step 1 with a `Bebida` type badge. Selecting one adds it directly to the cart (direct-sale flow — skips flavor and toppings steps). No change to order flow code required.

---

## Out of Scope

- Real-time inventory deduction at order time (order placement does not write to inventory)
- Low-stock alerts or push notifications
- Inventory tracking for CONE/CONTAINER usage from orders
- More than 8 oz container sizes
