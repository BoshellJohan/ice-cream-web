# Helados App — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the full-stack project (NestJS + Angular + PostgreSQL via Docker Compose), define the complete Prisma schema, implement JWT authentication, and deliver a working login screen that redirects by role.

**Architecture:** Two subdirectories in `helados-app/`: `helados-api/` (NestJS REST API) and `helados-ui/` (Angular SPA). Docker Compose runs PostgreSQL, the NestJS dev server, and the Angular dev server together. Auth uses JWTs issued by NestJS, sent as `Authorization: Bearer` headers by an Angular HTTP interceptor.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, Angular 18 (standalone), Tailwind CSS 3, bcrypt, @nestjs/jwt, @nestjs/passport, passport-jwt

---

## Plan Roadmap

| Plan | Covers | Depends on |
|---|---|---|
| **1 (this)** | Foundation, Auth, Login screen | — |
| **2** | Catalog CRUD (products, flavors, toppings + Cloudinary images), Users, Coupons | Plan 1 |
| **3** | Visual Order flow (5-step tablet UI), coupon validation, Order History | Plan 2 |
| **4** | Inventory snapshots + morning/night comparison, Analytics Dashboard | Plan 3 |

---

## File Map

### Root
```
helados-app/
├── docker-compose.yml
└── .gitignore
```

### helados-api/
```
helados-api/
├── Dockerfile.dev
├── .env.example
├── package.json
├── tsconfig.json
├── nest-cli.json
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── prisma/
    │   ├── prisma.module.ts
    │   └── prisma.service.ts
    └── auth/
        ├── auth.module.ts
        ├── auth.service.ts
        ├── auth.controller.ts
        ├── jwt.strategy.ts
        ├── jwt-auth.guard.ts
        ├── roles.guard.ts
        ├── roles.decorator.ts
        └── dto/
            ├── login.dto.ts
            └── change-password.dto.ts
```

### helados-ui/
```
helados-ui/
├── Dockerfile.dev
├── package.json
├── angular.json
├── tailwind.config.js
└── src/
    ├── environments/
    │   ├── environment.ts
    │   └── environment.prod.ts
    └── app/
        ├── app.config.ts
        ├── app.routes.ts
        ├── app.component.ts
        ├── core/
        │   ├── services/auth.service.ts
        │   ├── interceptors/auth.interceptor.ts
        │   └── guards/
        │       ├── auth.guard.ts
        │       └── admin.guard.ts
        └── features/
            ├── auth/login/
            │   ├── login.component.ts
            │   └── login.component.html
            ├── orders/
            │   ├── new-order/new-order.component.ts      (stub)
            │   └── order-history/order-history.component.ts (stub)
            ├── analytics/dashboard/dashboard.component.ts  (stub)
            ├── inventory/inventory.component.ts            (stub)
            ├── catalog/catalog.component.ts                (stub)
            ├── coupons/coupons.component.ts                (stub)
            └── users/users.component.ts                    (stub)
```

---

## Task 1: Workspace setup and Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `.gitignore`
- Create: `helados-api/Dockerfile.dev`
- Create: `helados-ui/Dockerfile.dev`

- [ ] **Step 1: Create root .gitignore**

Create `helados-app/.gitignore`:
```
node_modules/
dist/
.env
.superpowers/
*.log
```

- [ ] **Step 2: Create helados-api/Dockerfile.dev**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]
```

- [ ] **Step 3: Create helados-ui/Dockerfile.dev**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4200
CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--poll", "2000"]
```

- [ ] **Step 4: Create docker-compose.yml**

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: helados
      POSTGRES_PASSWORD: helados
      POSTGRES_DB: helados_dev
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  api:
    build:
      context: ./helados-api
      dockerfile: Dockerfile.dev
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://USUARIO:CONTRASENA@postgres:5432/helados_dev
      JWT_SECRET: ${JWT_SECRET}
    volumes:
      - ./helados-api:/app
      - /app/node_modules
    depends_on:
      - postgres

  ui:
    build:
      context: ./helados-ui
      dockerfile: Dockerfile.dev
    ports:
      - '4200:4200'
    volumes:
      - ./helados-ui:/app
      - /app/node_modules
    depends_on:
      - api

volumes:
  postgres_data:
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore docker-compose.yml helados-api/Dockerfile.dev helados-ui/Dockerfile.dev
git commit -m "chore: add docker-compose and dockerfiles"
```

---

## Task 2: NestJS project scaffold

**Files:**
- Create: `helados-api/` (via NestJS CLI)
- Create: `helados-api/.env.example`

- [ ] **Step 1: Scaffold NestJS project**

Run from `helados-app/`:
```bash
npx @nestjs/cli new helados-api --package-manager npm --skip-git
```

Choose `npm` when prompted.

- [ ] **Step 2: Install dependencies**

```bash
cd helados-api
npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt class-validator class-transformer
npm install --save-dev @types/passport-jwt @types/bcrypt
```

- [ ] **Step 3: Replace main.ts**

Replace `helados-api/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors({ origin: 'http://localhost:4200' });
  await app.listen(3000);
}
bootstrap();
```

- [ ] **Step 4: Create .env.example**

Create `helados-api/.env.example`:
```
DATABASE_URL=postgresql://USUARIO:CONTRASENA@localhost:5432/helados_dev
JWT_SECRET=<secreto-aleatorio>
```

Copy it to `.env`:
```bash
cp helados-api/.env.example helados-api/.env
```

- [ ] **Step 5: Commit**

```bash
git add helados-api/
git commit -m "chore: scaffold NestJS project"
```

---

## Task 3: Prisma schema and migrations

**Files:**
- Create: `helados-api/prisma/schema.prisma`
- Create: `helados-api/prisma/seed.ts`
- Modify: `helados-api/package.json`

- [ ] **Step 1: Install Prisma**

```bash
cd helados-api
npm install prisma @prisma/client
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write schema.prisma**

Replace `helados-api/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  STAFF
  ADMIN
}

enum ProductType {
  CONE
  CONTAINER
  CUP
  BOWL
}

enum ProductSize {
  SMALL
  MEDIUM
  LARGE
}

enum DiscountType {
  PERCENTAGE
  FIXED
}

enum SnapshotPeriod {
  MORNING
  NIGHT
}

model User {
  id           String              @id @default(uuid())
  name         String
  email        String              @unique
  passwordHash String
  role         Role                @default(STAFF)
  active       Boolean             @default(true)
  createdAt    DateTime            @default(now())
  orders       Order[]
  snapshots    InventorySnapshot[]
}

model Product {
  id         String      @id @default(uuid())
  name       String
  type       ProductType
  size       ProductSize
  basePrice  Decimal     @db.Decimal(10, 2)
  imageUrl   String?
  active     Boolean     @default(true)
  createdAt  DateTime    @default(now())
  orderItems OrderItem[]
}

model Flavor {
  id             String          @id @default(uuid())
  name           String
  priceModifier  Decimal         @db.Decimal(10, 2) @default(0)
  imageUrl       String?
  active         Boolean         @default(true)
  orderItems     OrderItem[]
  inventoryLines InventoryLine[]
}

model Topping {
  id                String             @id @default(uuid())
  name              String
  unitPrice         Decimal            @db.Decimal(10, 2)
  imageUrl          String?
  active            Boolean            @default(true)
  orderItemToppings OrderItemTopping[]
  inventoryLines    InventoryLine[]
}

model Coupon {
  id            String       @id @default(uuid())
  code          String       @unique
  discountType  DiscountType
  discountValue Decimal      @db.Decimal(10, 2)
  maxUses       Int?
  usesCount     Int          @default(0)
  validFrom     DateTime?
  validUntil    DateTime?
  active        Boolean      @default(true)
  orders        Order[]
}

model Order {
  id             String      @id @default(uuid())
  staffId        String
  staff          User        @relation(fields: [staffId], references: [id])
  couponId       String?
  coupon         Coupon?     @relation(fields: [couponId], references: [id])
  createdAt      DateTime    @default(now())
  subtotal       Decimal     @db.Decimal(10, 2)
  discountAmount Decimal     @db.Decimal(10, 2) @default(0)
  totalAmount    Decimal     @db.Decimal(10, 2)
  notes          String?
  items          OrderItem[]
}

model OrderItem {
  id        String             @id @default(uuid())
  orderId   String
  order     Order              @relation(fields: [orderId], references: [id])
  productId String
  product   Product            @relation(fields: [productId], references: [id])
  flavorId  String
  flavor    Flavor             @relation(fields: [flavorId], references: [id])
  itemTotal Decimal            @db.Decimal(10, 2)
  toppings  OrderItemTopping[]
}

model OrderItemTopping {
  id          String    @id @default(uuid())
  orderItemId String
  orderItem   OrderItem @relation(fields: [orderItemId], references: [id])
  toppingId   String
  topping     Topping   @relation(fields: [toppingId], references: [id])
  quantity    Int
}

model InventorySnapshot {
  id      String          @id @default(uuid())
  takenBy String
  user    User            @relation(fields: [takenBy], references: [id])
  takenAt DateTime        @default(now())
  period  SnapshotPeriod
  notes   String?
  lines   InventoryLine[]
}

model InventoryLine {
  id         String            @id @default(uuid())
  snapshotId String
  snapshot   InventorySnapshot @relation(fields: [snapshotId], references: [id])
  flavorId   String?
  flavor     Flavor?           @relation(fields: [flavorId], references: [id])
  toppingId  String?
  topping    Topping?          @relation(fields: [toppingId], references: [id])
  quantity   Decimal           @db.Decimal(10, 2)
}
```

Note: `InventoryLine` uses two nullable FKs (`flavorId`, `toppingId`) rather than a polymorphic `refId`. Application code enforces that exactly one is set per line.

- [ ] **Step 3: Run migration**

Start PostgreSQL first:
```bash
docker compose up postgres -d
```

Then from `helados-api/`:
```bash
npx dotenv -e .env -- prisma migrate dev --name init
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 4: Write seed script**

Create `helados-api/prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: 'admin@helados.com' } });
  if (existing) return;

  await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@helados.com',
      passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 10),
      role: 'ADMIN',
    },
  });
  console.log('Seeded: admin@helados.com / <SEED_ADMIN_PASSWORD>');
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 5: Add prisma scripts to package.json**

Add to `helados-api/package.json` under `"scripts"`:
```json
"prisma:migrate": "prisma migrate dev",
"prisma:seed": "ts-node prisma/seed.ts",
"prisma:studio": "prisma studio"
```

Add at the root level of `helados-api/package.json`:
```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

- [ ] **Step 6: Run seed**

```bash
npx dotenv -e .env -- ts-node prisma/seed.ts
```

Expected: `Seeded: admin@helados.com / <SEED_ADMIN_PASSWORD>`

- [ ] **Step 7: Commit**

```bash
git add helados-api/prisma/ helados-api/package.json
git commit -m "feat: add prisma schema with all 10 tables and seed admin user"
```

---

## Task 4: Prisma module

**Files:**
- Create: `helados-api/src/prisma/prisma.service.ts`
- Create: `helados-api/src/prisma/prisma.service.spec.ts`
- Create: `helados-api/src/prisma/prisma.module.ts`
- Modify: `helados-api/src/app.module.ts`

- [ ] **Step 1: Write failing test**

Create `helados-api/src/prisma/prisma.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    service = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd helados-api
npm test -- --testPathPattern=prisma.service
```

Expected: FAIL — `Cannot find module './prisma.service'`

- [ ] **Step 3: Implement PrismaService**

Create `helados-api/src/prisma/prisma.service.ts`:
```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=prisma.service
```

Expected: PASS

- [ ] **Step 5: Create PrismaModule**

Create `helados-api/src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Register in AppModule**

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add helados-api/src/prisma/ helados-api/src/app.module.ts
git commit -m "feat: add global prisma module"
```

---

## Task 5: Auth DTOs and service

**Files:**
- Create: `helados-api/src/auth/dto/login.dto.ts`
- Create: `helados-api/src/auth/dto/change-password.dto.ts`
- Create: `helados-api/src/auth/auth.service.ts`
- Create: `helados-api/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/auth/dto/login.dto.ts`:
```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

Create `helados-api/src/auth/dto/change-password.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
```

- [ ] **Step 2: Write failing test for AuthService**

Create `helados-api/src/auth/auth.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUser = {
  id: 'uuid-1',
  name: 'Staff',
  email: 'staff@helados.com',
  passwordHash: '$2b$10$hashedpassword',
  role: 'STAFF' as const,
  active: true,
  createdAt: new Date(),
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns null for unknown email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await service.validateUser('x@x.com', 'pass')).toBeNull();
  });

  it('returns null for inactive user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, active: false });
    expect(await service.validateUser('staff@helados.com', 'pass')).toBeNull();
  });

  it('throws UnauthorizedException on bad credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'x@x.com', password: 'bad' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns token and role on valid login', async () => {
    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    const result = await service.login({ email: 'staff@helados.com', password: 'pass' });
    expect(result).toEqual({ accessToken: 'mock.jwt.token', role: 'STAFF', name: 'Staff' });
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=auth.service
```

Expected: FAIL — `Cannot find module './auth.service'`

- [ ] **Step 4: Implement AuthService**

Create `helados-api/src/auth/auth.service.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;
    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const payload = { sub: user.id, role: user.role };
    return {
      accessToken: this.jwt.sign(payload),
      role: user.role,
      name: user.name,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=auth.service
```

Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add helados-api/src/auth/
git commit -m "feat: add auth service (login, validate, change-password)"
```

---

## Task 6: JWT strategy and guards

**Files:**
- Create: `helados-api/src/auth/jwt.strategy.ts`
- Create: `helados-api/src/auth/jwt-auth.guard.ts`
- Create: `helados-api/src/auth/roles.decorator.ts`
- Create: `helados-api/src/auth/roles.guard.ts`

- [ ] **Step 1: Create JWT strategy**

Create `helados-api/src/auth/jwt.strategy.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret',
    });
  }

  validate(payload: { sub: string; role: string }) {
    return { id: payload.sub, role: payload.role };
  }
}
```

- [ ] **Step 2: Create JwtAuthGuard**

Create `helados-api/src/auth/jwt-auth.guard.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 3: Create Roles decorator**

Create `helados-api/src/auth/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

- [ ] **Step 4: Create RolesGuard**

Create `helados-api/src/auth/roles.guard.ts`:
```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) return true;
    const { user } = context.switchToHttp().getRequest();
    return roles.includes(user.role);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add helados-api/src/auth/jwt.strategy.ts helados-api/src/auth/jwt-auth.guard.ts helados-api/src/auth/roles.decorator.ts helados-api/src/auth/roles.guard.ts
git commit -m "feat: add jwt strategy, auth guard, and roles guard"
```

---

## Task 7: Auth controller and module wiring

**Files:**
- Create: `helados-api/src/auth/auth.controller.ts`
- Create: `helados-api/src/auth/auth.controller.spec.ts`
- Create: `helados-api/src/auth/auth.module.ts`
- Modify: `helados-api/src/app.module.ts`

- [ ] **Step 1: Write failing test**

Create `helados-api/src/auth/auth.controller.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  login: jest.fn().mockResolvedValue({ accessToken: 'tok', role: 'STAFF', name: 'Staff' }),
  changePassword: jest.fn().mockResolvedValue(undefined),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('login returns token', async () => {
    const result = await controller.login({ email: 'a@b.com', password: 'pass123' });
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('role');
  });

  it('changePassword delegates to service', async () => {
    await controller.changePassword(
      { user: { id: 'uid', role: 'STAFF' } },
      { currentPassword: 'old123', newPassword: 'new123' },
    );
    expect(mockAuthService.changePassword).toHaveBeenCalledWith('uid', {
      currentPassword: 'old123',
      newPassword: 'new123',
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=auth.controller
```

Expected: FAIL — `Cannot find module './auth.controller'`

- [ ] **Step 3: Implement AuthController**

Create `helados-api/src/auth/auth.controller.ts`:
```typescript
import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Request() req: { user: { id: string; role: string } }, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.id, dto);
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=auth.controller
```

Expected: PASS — 2 tests

- [ ] **Step 5: Create AuthModule**

Create `helados-api/src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  providers: [AuthService, JwtStrategy, RolesGuard],
  controllers: [AuthController],
  exports: [AuthService, RolesGuard],
})
export class AuthModule {}
```

- [ ] **Step 6: Register AuthModule in AppModule**

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

- [ ] **Step 7: Smoke-test the API**

```bash
docker compose up postgres api -d
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@helados.com","password":"<SEED_ADMIN_PASSWORD>"}'
```

Expected: `{"accessToken":"eyJ...","role":"ADMIN","name":"Admin"}`

- [ ] **Step 8: Commit**

```bash
git add helados-api/src/auth/auth.controller.ts helados-api/src/auth/auth.controller.spec.ts helados-api/src/auth/auth.module.ts helados-api/src/app.module.ts
git commit -m "feat: wire auth module — controller, JWT module, passport"
```

---

## Task 8: Angular project scaffold and Tailwind

**Files:**
- Create: `helados-ui/` (via Angular CLI)
- Modify: `helados-ui/tailwind.config.js`
- Modify: `helados-ui/src/styles.css`
- Create: `helados-ui/src/environments/environment.ts`
- Create: `helados-ui/src/environments/environment.prod.ts`

- [ ] **Step 1: Scaffold Angular project**

Run from `helados-app/`:
```bash
npx @angular/cli new helados-ui --routing --style=css --skip-git --standalone
```

- [ ] **Step 2: Install Tailwind**

```bash
cd helados-ui
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init
```

- [ ] **Step 3: Configure tailwind.config.js**

Replace `helados-ui/tailwind.config.js`:
```javascript
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4ff',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Add Tailwind directives to styles.css**

Replace `helados-ui/src/styles.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  height: 100%;
  margin: 0;
}
```

- [ ] **Step 5: Create environment files**

Create `helados-ui/src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
};
```

Create `helados-ui/src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://your-api.railway.app',
};
```

- [ ] **Step 6: Commit**

```bash
cd ..
git add helados-ui/
git commit -m "chore: scaffold Angular 18 project with Tailwind CSS"
```

---

## Task 9: Angular auth service, interceptor, and guards

**Files:**
- Create: `helados-ui/src/app/core/services/auth.service.ts`
- Create: `helados-ui/src/app/core/interceptors/auth.interceptor.ts`
- Create: `helados-ui/src/app/core/guards/auth.guard.ts`
- Create: `helados-ui/src/app/core/guards/admin.guard.ts`

- [ ] **Step 1: Create AuthService**

Create `helados-ui/src/app/core/services/auth.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

interface LoginResponse {
  accessToken: string;
  role: 'STAFF' | 'ADMIN';
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  login(email: string, password: string) {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(
        tap((res) => {
          localStorage.setItem('token', res.accessToken);
          localStorage.setItem('role', res.role);
          localStorage.setItem('name', res.name);
        }),
      );
  }

  logout() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getRole(): string | null {
    return localStorage.getItem('role');
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  isAdmin(): boolean {
    return this.getRole() === 'ADMIN';
  }
}
```

- [ ] **Step 2: Create auth interceptor**

Create `helados-ui/src/app/core/interceptors/auth.interceptor.ts`:
```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();

  const cloned = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(cloned).pipe(
    catchError((err) => {
      if (err.status === 401) auth.logout();
      if (err.status === 403) router.navigate(['/orders/new']);
      return throwError(() => err);
    }),
  );
};
```

- [ ] **Step 3: Create auth guard**

Create `helados-ui/src/app/core/guards/auth.guard.ts`:
```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn()) return true;
  return router.createUrlTree(['/login']);
};
```

- [ ] **Step 4: Create admin guard**

Create `helados-ui/src/app/core/guards/admin.guard.ts`:
```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  return router.createUrlTree(['/orders/new']);
};
```

- [ ] **Step 5: Commit**

```bash
git add helados-ui/src/app/core/
git commit -m "feat: add Angular auth service, interceptor, and route guards"
```

---

## Task 10: Login component, stub pages, and routing

**Files:**
- Create: `helados-ui/src/app/features/auth/login/login.component.ts`
- Create: `helados-ui/src/app/features/auth/login/login.component.html`
- Create: stub components for all future routes
- Modify: `helados-ui/src/app/app.routes.ts`
- Modify: `helados-ui/src/app/app.config.ts`
- Modify: `helados-ui/src/app/app.component.ts`

- [ ] **Step 1: Create LoginComponent**

Create `helados-ui/src/app/features/auth/login/login.component.ts`:
```typescript
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;

  private auth = inject(AuthService);
  private router = inject(Router);

  onSubmit() {
    this.error = '';
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: (res) => {
        this.loading = false;
        this.router.navigate(res.role === 'ADMIN' ? ['/dashboard'] : ['/orders/new']);
      },
      error: () => {
        this.loading = false;
        this.error = 'Correo o contraseña incorrectos';
      },
    });
  }
}
```

- [ ] **Step 2: Create login template**

Create `helados-ui/src/app/features/auth/login/login.component.html`:
```html
<div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-white">🍦 Helados</h1>
      <p class="text-gray-400 mt-1 text-sm">Inicia sesión para continuar</p>
    </div>

    <form (ngSubmit)="onSubmit()" class="bg-gray-900 rounded-2xl p-8 shadow-xl space-y-5">
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">Correo</label>
        <input
          type="email"
          [(ngModel)]="email"
          name="email"
          required
          class="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-base border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
          placeholder="correo@helados.com"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">Contraseña</label>
        <input
          type="password"
          [(ngModel)]="password"
          name="password"
          required
          class="w-full bg-gray-800 text-white rounded-lg px-4 py-3 text-base border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
          placeholder="••••••••"
        />
      </div>

      @if (error) {
        <p class="text-red-400 text-sm text-center">{{ error }}</p>
      }

      <button
        type="submit"
        [disabled]="loading"
        class="w-full bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50 text-white font-semibold py-3 rounded-lg text-base transition-colors touch-manipulation"
      >
        {{ loading ? 'Entrando...' : 'Entrar' }}
      </button>
    </form>
  </div>
</div>
```

- [ ] **Step 3: Create stub components for future routes**

Create `helados-ui/src/app/features/orders/new-order/new-order.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-new-order', standalone: true, template: '<p class="text-white p-8 text-xl">Nueva Orden — Plan 3</p>' })
export class NewOrderComponent {}
```

Create `helados-ui/src/app/features/orders/order-history/order-history.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-order-history', standalone: true, template: '<p class="text-white p-8 text-xl">Historial — Plan 3</p>' })
export class OrderHistoryComponent {}
```

Create `helados-ui/src/app/features/analytics/dashboard/dashboard.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-dashboard', standalone: true, template: '<p class="text-white p-8 text-xl">Dashboard — Plan 4</p>' })
export class DashboardComponent {}
```

Create `helados-ui/src/app/features/inventory/inventory.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-inventory', standalone: true, template: '<p class="text-white p-8 text-xl">Inventario — Plan 4</p>' })
export class InventoryComponent {}
```

Create `helados-ui/src/app/features/catalog/catalog.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-catalog', standalone: true, template: '<p class="text-white p-8 text-xl">Catálogo — Plan 2</p>' })
export class CatalogComponent {}
```

Create `helados-ui/src/app/features/coupons/coupons.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-coupons', standalone: true, template: '<p class="text-white p-8 text-xl">Cupones — Plan 2</p>' })
export class CouponsComponent {}
```

Create `helados-ui/src/app/features/users/users.component.ts`:
```typescript
import { Component } from '@angular/core';
@Component({ selector: 'app-users', standalone: true, template: '<p class="text-white p-8 text-xl">Usuarios — Plan 2</p>' })
export class UsersComponent {}
```

- [ ] **Step 4: Set up routes**

Replace `helados-ui/src/app/app.routes.ts`:
```typescript
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'orders',
    canActivate: [authGuard],
    children: [
      {
        path: 'new',
        loadComponent: () =>
          import('./features/orders/new-order/new-order.component').then((m) => m.NewOrderComponent),
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./features/orders/order-history/order-history.component').then((m) => m.OrderHistoryComponent),
      },
    ],
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/analytics/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'inventory',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/inventory/inventory.component').then((m) => m.InventoryComponent),
  },
  {
    path: 'catalog',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/catalog/catalog.component').then((m) => m.CatalogComponent),
  },
  {
    path: 'coupons',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/coupons/coupons.component').then((m) => m.CouponsComponent),
  },
  {
    path: 'users',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/users/users.component').then((m) => m.UsersComponent),
  },
  { path: '**', redirectTo: '/login' },
];
```

- [ ] **Step 5: Configure app providers**

Replace `helados-ui/src/app/app.config.ts`:
```typescript
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```

- [ ] **Step 6: Simplify AppComponent**

Replace `helados-ui/src/app/app.component.ts`:
```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {}
```

- [ ] **Step 7: Start full stack and verify login**

```bash
docker compose up
```

Open http://localhost:4200 — should redirect to `/login`.
Log in with `admin@helados.com` / `<SEED_ADMIN_PASSWORD>`.
Should redirect to `/dashboard` showing "Dashboard — Plan 4".
Log out (clear localStorage) and log in as staff — should go to `/orders/new`.

- [ ] **Step 8: Commit**

```bash
git add helados-ui/src/app/
git commit -m "feat: add login screen, role-based routing, and stub pages"
```

---

## Plan 1 Complete

The app now has:
- Docker Compose stack (PostgreSQL 16 + NestJS + Angular)
- Complete Prisma schema — all 10 tables, all enums, all relations
- JWT authentication — login endpoint, 8h token, guards, roles decorator
- Seed script — admin@helados.com / <SEED_ADMIN_PASSWORD>
- Angular login screen — Tailwind UI, role-based redirect on success
- Auth interceptor — attaches Bearer token, redirects on 401/403
- Stub pages for all future routes so routing compiles

**Next:** Plan 2 — Catalog management (products, flavors, toppings CRUD + Cloudinary image upload), Users management, Coupons management.
