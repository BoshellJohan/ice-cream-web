# 🍦 helados-app

Aplicación web interna para una startup de helados. La usa el personal (4–5 personas) desde una **tablet en orientación horizontal**. No es una app de cara al público: se prioriza la simplicidad y la comodidad táctil sobre una UX compleja.

---

## 📋 Tabla de contenidos

- [Descripción general](#-descripción-general)
- [Stack tecnológico](#-stack-tecnológico)
- [Estructura del repositorio](#-estructura-del-repositorio)
- [Requisitos previos](#-requisitos-previos)
- [Puesta en marcha](#-puesta-en-marcha)
- [Variables de entorno](#-variables-de-entorno)
- [Base de datos y datos de prueba](#-base-de-datos-y-datos-de-prueba)
- [Módulos y rutas de la API](#-módulos-y-rutas-de-la-api)
- [Rutas y vistas del frontend](#-rutas-y-vistas-del-frontend)
- [Pruebas](#-pruebas)
- [Flujo de desarrollo](#-flujo-de-desarrollo)
- [Despliegue](#-despliegue)

---

## 🎯 Descripción general

`helados-app` cubre la operación diaria del negocio:

- **Toma de pedidos** en un flujo visual de 5 pasos (producto → sabor → toppings → cupón → revisión y pago).
- **Catálogo** de productos, sabores y toppings administrable por el rol ADMIN.
- **Inventario** mediante snapshots de mañana/noche con registro de auditoría de ediciones.
- **Cupones** de descuento con validación.
- **Panel de analíticas** con ingresos, ítems más vendidos, análisis por día y **conciliación de caja** (comparación entre lo registrado por el sistema y el efectivo/QR real recibido).

---

## 🧱 Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Angular 18 (componentes standalone), Tailwind CSS |
| Backend | NestJS 11 + Prisma 5 + PostgreSQL |
| Imágenes | Cloudinary (capa gratuita) |
| Autenticación | JWT (expira en 8 h), almacenado en `localStorage` |
| Desarrollo local | Docker Compose (solo PostgreSQL) |
| Despliegue | Neon (PostgreSQL), Railway (API NestJS), Vercel o Netlify (Angular estático) |

---

## 📂 Estructura del repositorio

```
helados-app/
├── helados-api/        # API NestJS + Prisma
├── helados-ui/         # Frontend Angular
├── docs/               # Especificaciones y planes de desarrollo
├── docker-compose.yml  # PostgreSQL (y servicios opcionales) para local
└── CLAUDE.md           # Contexto del proyecto para asistencia con IA
```

---

## ✅ Requisitos previos

- **Node.js** 20+ y **npm**
- **Docker** y **Docker Compose** (para la base de datos local)
- **PostgreSQL 17** cliente (`psql`) — opcional, para inspección manual

> ℹ️ En algunas máquinas `psql` no está en el `PATH`. Puedes usarlo así:
> ```bash
> PGPASSWORD=helados /Library/PostgreSQL/17/bin/psql -U helados -d helados_dev
> ```

---

## 🚀 Puesta en marcha

```bash
# 1. Levantar PostgreSQL local
docker-compose up -d

# 2. API (modo desarrollo)
cd helados-api
npm install
npm run prisma:migrate      # aplica las migraciones
npm run prisma:seed         # crea el usuario admin y la configuración inicial
npm run start:dev           # http://localhost:3000

# 3. UI (modo desarrollo, en otra terminal)
cd helados-ui
npm install
npx ng serve                # http://localhost:4200
```

Verificación rápida de la build de Angular:

```bash
cd helados-ui && npx ng build --configuration=development
```

---

## 🔐 Variables de entorno

Crea `helados-api/.env` (está en `.gitignore`):

```env
DATABASE_URL=postgresql://helados:helados@localhost:5432/helados_dev
JWT_SECRET=dev-secret-change-in-production
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

El frontend Angular lee la URL de la API desde `helados-ui/src/environments/environment.ts` (**no** usa `VITE_API_URL`).

---

## 🌱 Base de datos y datos de prueba

El seed crea un usuario inicial:

| Campo | Valor |
|---|---|
| Nombre | `Admin` |
| Email | `admin@helados.com` |
| Contraseña | `admin1234` |
| Rol | `ADMIN` |

También crea (upsert) las filas de `ToppingTypeConfig` para `NORMAL` y `PREMIUM` (con `unitPrice` inicial en 0).

> 📧 **Normalización de emails:** siempre se aplica `.toLowerCase()` antes de `findUnique` y `create`, porque PostgreSQL distingue mayúsculas/minúsculas.

---

## 🧩 Módulos y rutas de la API

Autenticación por guards:

- `@UseGuards(JwtAuthGuard)` a nivel de clase → cualquier usuario autenticado.
- `@UseGuards(RolesGuard) @Roles('ADMIN')` a nivel de método → solo ADMIN.

| Módulo | Rutas principales |
|---|---|
| **AuthModule** | `POST /auth/login` (público), `POST /auth/change-password` (JWT) |
| **UsersModule** | `GET/POST /users`, `PATCH /users/:id/role`, `PATCH /users/:id/deactivate` — solo ADMIN |
| **ProductsModule** | `GET /products` (cualquier auth), escrituras solo ADMIN |
| **FlavorsModule** | `GET /flavors` (cualquier auth), escrituras solo ADMIN |
| **ToppingsModule** | `GET /toppings`, `GET /toppings/type-config` (cualquier auth), escrituras solo ADMIN |
| **CouponsModule** | `POST /coupons/validate` (cualquier auth), resto solo ADMIN |
| **ImagesModule** | `POST /images/upload` — ADMIN, límite 5 MB, sube a Cloudinary |
| **OrdersModule** | `POST /orders`, `GET /orders`, `GET /orders/:id` — cualquier auth |
| **InventoryModule** | `POST/GET /inventory/snapshots`, `GET /inventory/snapshots/day`, `PATCH /inventory/snapshots/:id` — solo ADMIN |
| **AnalyticsModule** | `GET /analytics/summary`, `/top-items`, `/daily`, `/reconciliation`, `/reconciliation-summary` — solo ADMIN |

> 🛒 **Lectura vs. escritura del catálogo:** el personal necesita leer productos/sabores/toppings para tomar pedidos (`GET` con cualquier auth), pero solo ADMIN puede crear o editar.

> 🎟️ **Validación de cupones:** devuelve `UnprocessableEntityException` (422), no 400, y los mensajes de error están en español.

---

## 🖥️ Rutas y vistas del frontend

| Ruta | Guard | Componente / propósito |
|---|---|---|
| `/login` | — | Inicio de sesión |
| `/orders/new` | authGuard | Flujo visual de pedido en 5 pasos |
| `/orders/history` | authGuard | Historial con filtro por rango de fechas |
| `/dashboard` | authGuard + adminGuard | Resumen de ingresos, top de ítems y **conciliación de caja** |
| `/dashboard/daily` | authGuard + adminGuard | Análisis diario y comparación entre dos días |
| `/inventory` | authGuard + adminGuard | Snapshots de mañana/noche con auditoría de ediciones |
| `/catalog` | authGuard + adminGuard | Pestañas: Productos / Sabores / Toppings |
| `/coupons` | authGuard + adminGuard | Gestión de cupones |
| `/users` | authGuard + adminGuard | Gestión de usuarios |

Convenciones de Angular usadas en el proyecto:

- Inyección de dependencias con la función `inject()` (sin inyección por constructor).
- Interceptor funcional (`HttpInterceptorFn`): agrega el Bearer JWT; en 401 llama a `auth.logout()`, en 403 redirige a `/orders/new`.
- Guards funcionales (`CanActivateFn`): `authGuard` (sesión iniciada) y `adminGuard` (rol ADMIN).
- Tema oscuro: fondos `gray-950`, tarjetas `gray-900`; morado de marca `purple-600` / `purple-700`.

---

## 🧪 Pruebas

**Backend (Jest):**

```bash
cd helados-api
npm test              # suite completa
npm run test:watch    # modo watch
npm run test:cov      # con cobertura
```

**Frontend:** el proyecto valida los cambios con la build de Angular:

```bash
cd helados-ui && npx ng build --configuration=development
```

---

## 🔧 Flujo de desarrollo

- Las ramas de features usan git worktrees bajo `.worktrees/` (ignorado por git).
- Los planes viven en `docs/superpowers/plans/` y las especificaciones en `docs/superpowers/specs/`.
- El desarrollo sigue: implementación → revisión de cumplimiento del spec → revisión de calidad de código → marcar como hecho.

---

## ☁️ Despliegue

| Componente | Servicio |
|---|---|
| Base de datos PostgreSQL | Neon |
| API NestJS | Railway |
| Frontend Angular (estático) | Vercel o Netlify |

Recuerda cambiar `JWT_SECRET` y configurar las credenciales de Cloudinary y la `DATABASE_URL` de producción en el entorno de despliegue.

---

## 📄 Licencia

Proyecto interno privado. Todos los derechos reservados.
