# Helados App — Plan 2: Catalog, Users & Coupons

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full CRUD management for Products, Flavors, Toppings, Coupons, and Users — including Cloudinary image upload — so admins can maintain the catalog before orders can be placed.

**Architecture:** NestJS backend adds 6 new modules (users, products, flavors, toppings, coupons, images), each following the Plan 1 pattern (service + controller + module + DTOs + unit tests). Every module is registered in AppModule as it's created. The Angular frontend adds typed HTTP services, a shared image upload component, and three full management pages (Catalog with 3 tabs, Coupons, Users) replacing the Plan 1 stubs. All admin routes are already guarded by `adminGuard` from Plan 1.

**Tech Stack:** NestJS + Prisma 5 + class-validator + `cloudinary` npm package + multer (already available via `@nestjs/platform-express`); Angular 18 standalone + Tailwind CSS

---

## Plan Roadmap

| Plan | Covers | Depends on |
|---|---|---|
| 1 | Foundation, Auth, Login | — |
| **2 (this)** | Catalog CRUD, Users, Coupons, Cloudinary | Plan 1 |
| 3 | Visual Order flow (5-step), Order History | Plan 2 |
| 4 | Inventory snapshots + comparison, Analytics Dashboard | Plan 3 |

---

## File Map

### helados-api/src/

```
users/
  dto/create-user.dto.ts
  dto/change-role.dto.ts
  users.service.ts
  users.service.spec.ts
  users.controller.ts
  users.controller.spec.ts
  users.module.ts

products/
  dto/create-product.dto.ts
  dto/update-product.dto.ts
  products.service.ts
  products.service.spec.ts
  products.controller.ts
  products.controller.spec.ts
  products.module.ts

flavors/
  dto/create-flavor.dto.ts
  dto/update-flavor.dto.ts
  flavors.service.ts
  flavors.service.spec.ts
  flavors.controller.ts
  flavors.controller.spec.ts
  flavors.module.ts

toppings/
  dto/create-topping.dto.ts
  dto/update-topping.dto.ts
  toppings.service.ts
  toppings.service.spec.ts
  toppings.controller.ts
  toppings.controller.spec.ts
  toppings.module.ts

coupons/
  dto/create-coupon.dto.ts
  dto/validate-coupon.dto.ts
  coupons.service.ts
  coupons.service.spec.ts
  coupons.controller.ts
  coupons.controller.spec.ts
  coupons.module.ts

images/
  images.service.ts
  images.controller.ts
  images.module.ts
```

### helados-ui/src/app/

```
core/
  models/
    product.model.ts
    flavor.model.ts
    topping.model.ts
    coupon.model.ts
    user.model.ts
  services/
    product.service.ts
    flavor.service.ts
    topping.service.ts
    coupon.service.ts
    user-admin.service.ts
    image-upload.service.ts

shared/
  components/
    image-upload/
      image-upload.component.ts
      image-upload.component.html

features/
  catalog/
    catalog.component.ts        (replaces Plan 1 stub)
    catalog.component.html
  coupons/
    coupons.component.ts        (replaces Plan 1 stub)
    coupons.component.html
  users/
    users.component.ts          (replaces Plan 1 stub)
    users.component.html
```

---

## Task 1: Users module (NestJS)

**Files:**
- Create: `helados-api/src/users/dto/create-user.dto.ts`
- Create: `helados-api/src/users/dto/change-role.dto.ts`
- Create: `helados-api/src/users/users.service.ts`
- Create: `helados-api/src/users/users.service.spec.ts`
- Create: `helados-api/src/users/users.controller.ts`
- Create: `helados-api/src/users/users.controller.spec.ts`
- Create: `helados-api/src/users/users.module.ts`
- Modify: `helados-api/src/app.module.ts`

**Context:** Work in `helados-app/.worktrees/plan-2-catalog/helados-api/`. PrismaModule is global — no need to import it in UsersModule. `JwtAuthGuard`, `RolesGuard`, and `@Roles` come from `helados-api/src/auth/`. `AuthModule` exports `RolesGuard`.

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/users/dto/create-user.dto.ts`:
```typescript
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(['STAFF', 'ADMIN'])
  role: 'STAFF' | 'ADMIN';

  @IsString()
  @MinLength(6)
  password: string;
}
```

Create `helados-api/src/users/dto/change-role.dto.ts`:
```typescript
import { IsEnum } from 'class-validator';

export class ChangeRoleDto {
  @IsEnum(['STAFF', 'ADMIN'])
  role: 'STAFF' | 'ADMIN';
}
```

- [ ] **Step 2: Write failing test for UsersService**

Create `helados-api/src/users/users.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockUser = {
  id: 'uid-1',
  name: 'Staff',
  email: 'staff@helados.com',
  role: 'STAFF' as const,
  active: true,
  createdAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll returns users without passwordHash', async () => {
    mockPrisma.user.findMany.mockResolvedValue([mockUser]);
    const result = await service.findAll();
    expect(result).toEqual([mockUser]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('create throws ConflictException if email taken', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    await expect(
      service.create({ name: 'X', email: 'staff@helados.com', role: 'STAFF', password: 'pass123' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('changeRole throws NotFoundException for unknown user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.changeRole('bad-id', 'ADMIN')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivate throws NotFoundException for unknown user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.deactivate('bad-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd helados-api
npm test -- --testPathPattern=users.service 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 4: Implement UsersService**

Create `helados-api/src/users/users.service.ts`:
```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: { name: dto.name, email: dto.email, role: dto.role, passwordHash },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
  }

  async changeRole(id: string, role: 'STAFF' | 'ADMIN') {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
  }

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.prisma.user.update({
      where: { id },
      data: { active: false },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=users.service 2>&1 | tail -10
```

Expected: PASS — 4 tests

- [ ] **Step 6: Write failing controller test**

Create `helados-api/src/users/users.controller.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockService = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 'uid', name: 'X', email: 'x@x.com', role: 'STAFF', active: true }),
  changeRole: jest.fn().mockResolvedValue({ id: 'uid', role: 'ADMIN' }),
  deactivate: jest.fn().mockResolvedValue({ id: 'uid', active: false }),
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockService }],
    }).compile();
    controller = module.get(UsersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll delegates to service', async () => {
    await controller.findAll();
    expect(mockService.findAll).toHaveBeenCalled();
  });

  it('create delegates to service', async () => {
    await controller.create({ name: 'X', email: 'x@x.com', role: 'STAFF', password: 'pass123' });
    expect(mockService.create).toHaveBeenCalled();
  });

  it('changeRole delegates to service', async () => {
    await controller.changeRole('uid', { role: 'ADMIN' });
    expect(mockService.changeRole).toHaveBeenCalledWith('uid', 'ADMIN');
  });

  it('deactivate delegates to service', async () => {
    await controller.deactivate('uid');
    expect(mockService.deactivate).toHaveBeenCalledWith('uid');
  });
});
```

- [ ] **Step 7: Implement UsersController**

Create `helados-api/src/users/users.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id/role')
  changeRole(@Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.users.changeRole(id, dto.role);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.users.deactivate(id);
  }
}
```

- [ ] **Step 8: Create UsersModule and register in AppModule**

Create `helados-api/src/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
```

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule],
})
export class AppModule {}
```

- [ ] **Step 9: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass (previous + 8 new = no regressions)

- [ ] **Step 10: Commit**

```bash
git add helados-api/src/users/ helados-api/src/app.module.ts
git commit -m "feat: add users module (list, create, change-role, deactivate)"
```

---

## Task 2: Products module (NestJS)

**Files:**
- Create: `helados-api/src/products/dto/create-product.dto.ts`
- Create: `helados-api/src/products/dto/update-product.dto.ts`
- Create: `helados-api/src/products/products.service.ts`
- Create: `helados-api/src/products/products.service.spec.ts`
- Create: `helados-api/src/products/products.controller.ts`
- Create: `helados-api/src/products/products.controller.spec.ts`
- Create: `helados-api/src/products/products.module.ts`
- Modify: `helados-api/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/products/dto/create-product.dto.ts`:
```typescript
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL'])
  type: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL';

  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size: 'SMALL' | 'MEDIUM' | 'LARGE';

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
```

Create `helados-api/src/products/dto/update-product.dto.ts`:
```typescript
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL'])
  type?: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
```

- [ ] **Step 2: Write failing test**

Create `helados-api/src/products/products.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockProduct = {
  id: 'pid-1', name: 'Small Cone', type: 'CONE', size: 'SMALL',
  basePrice: 2.5, imageUrl: null, active: true, createdAt: new Date(),
};

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ProductsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll passes active filter for staff', async () => {
    mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
    await service.findAll(false);
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('findAll passes no filter for admin', async () => {
    mockPrisma.product.findMany.mockResolvedValue([mockProduct]);
    await service.findAll(true);
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('toggleActive flips active flag', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
    mockPrisma.product.update.mockResolvedValue({ ...mockProduct, active: false });
    const result = await service.toggleActive('pid-1');
    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: 'pid-1' },
      data: { active: false },
    });
    expect(result.active).toBe(false);
  });

  it('toggleActive throws NotFoundException for unknown id', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    await expect(service.toggleActive('bad')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=products.service 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './products.service'`

- [ ] **Step 4: Implement ProductsService**

Create `helados-api/src/products/products.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async toggleActive(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return this.prisma.product.update({ where: { id }, data: { active: !product.active } });
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=products.service 2>&1 | tail -10
```

Expected: PASS — 4 tests

- [ ] **Step 6: Create controller**

Create `helados-api/src/products/products.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Get()
  findAll(@Request() req: { user: { role: string } }) {
    return this.products.findAll(req.user.role === 'ADMIN');
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  toggleActive(@Param('id') id: string) {
    return this.products.toggleActive(id);
  }
}
```

Create `helados-api/src/products/products.controller.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

const mockService = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 'pid' }),
  update: jest.fn().mockResolvedValue({ id: 'pid' }),
  toggleActive: jest.fn().mockResolvedValue({ id: 'pid', active: false }),
};

describe('ProductsController', () => {
  let controller: ProductsController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: mockService }],
    }).compile();
    controller = module.get(ProductsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll passes isAdmin=true for ADMIN', async () => {
    await controller.findAll({ user: { role: 'ADMIN' } });
    expect(mockService.findAll).toHaveBeenCalledWith(true);
  });

  it('findAll passes isAdmin=false for STAFF', async () => {
    await controller.findAll({ user: { role: 'STAFF' } });
    expect(mockService.findAll).toHaveBeenCalledWith(false);
  });

  it('toggleActive delegates to service', async () => {
    await controller.toggleActive('pid');
    expect(mockService.toggleActive).toHaveBeenCalledWith('pid');
  });
});
```

- [ ] **Step 7: Create ProductsModule and register in AppModule**

Create `helados-api/src/products/products.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  providers: [ProductsService],
  controllers: [ProductsController],
})
export class ProductsModule {}
```

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, ProductsModule],
})
export class AppModule {}
```

- [ ] **Step 8: Run full tests and commit**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

```bash
git add helados-api/src/products/ helados-api/src/app.module.ts
git commit -m "feat: add products module (CRUD + toggle-active, staff/admin filter)"
```

---

## Task 3: Flavors module (NestJS)

**Files:**
- Create: `helados-api/src/flavors/dto/create-flavor.dto.ts`
- Create: `helados-api/src/flavors/dto/update-flavor.dto.ts`
- Create: `helados-api/src/flavors/flavors.service.ts`
- Create: `helados-api/src/flavors/flavors.service.spec.ts`
- Create: `helados-api/src/flavors/flavors.controller.ts`
- Create: `helados-api/src/flavors/flavors.module.ts`
- Modify: `helados-api/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/flavors/dto/create-flavor.dto.ts`:
```typescript
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFlavorDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceModifier: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
```

Create `helados-api/src/flavors/dto/update-flavor.dto.ts`:
```typescript
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateFlavorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceModifier?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
```

- [ ] **Step 2: Write failing test**

Create `helados-api/src/flavors/flavors.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FlavorsService } from './flavors.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  flavor: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockFlavor = {
  id: 'fid-1', name: 'Chocolate', priceModifier: 0.5, imageUrl: null, active: true,
};

describe('FlavorsService', () => {
  let service: FlavorsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [FlavorsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(FlavorsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll filters to active by default', async () => {
    mockPrisma.flavor.findMany.mockResolvedValue([mockFlavor]);
    await service.findAll();
    expect(mockPrisma.flavor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('toggleActive flips active flag', async () => {
    mockPrisma.flavor.findUnique.mockResolvedValue(mockFlavor);
    mockPrisma.flavor.update.mockResolvedValue({ ...mockFlavor, active: false });
    await service.toggleActive('fid-1');
    expect(mockPrisma.flavor.update).toHaveBeenCalledWith({
      where: { id: 'fid-1' }, data: { active: false },
    });
  });

  it('toggleActive throws NotFoundException for unknown id', async () => {
    mockPrisma.flavor.findUnique.mockResolvedValue(null);
    await expect(service.toggleActive('bad')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=flavors.service 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './flavors.service'`

- [ ] **Step 4: Implement FlavorsService**

Create `helados-api/src/flavors/flavors.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlavorDto } from './dto/create-flavor.dto';
import { UpdateFlavorDto } from './dto/update-flavor.dto';

@Injectable()
export class FlavorsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.flavor.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateFlavorDto) {
    return this.prisma.flavor.create({ data: dto });
  }

  async update(id: string, dto: UpdateFlavorDto) {
    const flavor = await this.prisma.flavor.findUnique({ where: { id } });
    if (!flavor) throw new NotFoundException(`Flavor ${id} not found`);
    return this.prisma.flavor.update({ where: { id }, data: dto });
  }

  async toggleActive(id: string) {
    const flavor = await this.prisma.flavor.findUnique({ where: { id } });
    if (!flavor) throw new NotFoundException(`Flavor ${id} not found`);
    return this.prisma.flavor.update({ where: { id }, data: { active: !flavor.active } });
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=flavors.service 2>&1 | tail -10
```

Expected: PASS — 3 tests

- [ ] **Step 6: Create FlavorsController and FlavorsModule**

Create `helados-api/src/flavors/flavors.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FlavorsService } from './flavors.service';
import { CreateFlavorDto } from './dto/create-flavor.dto';
import { UpdateFlavorDto } from './dto/update-flavor.dto';

@Controller('flavors')
@UseGuards(JwtAuthGuard)
export class FlavorsController {
  constructor(private flavors: FlavorsService) {}

  @Get()
  findAll(@Request() req: { user: { role: string } }) {
    return this.flavors.findAll(req.user.role === 'ADMIN');
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateFlavorDto) {
    return this.flavors.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateFlavorDto) {
    return this.flavors.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  toggleActive(@Param('id') id: string) {
    return this.flavors.toggleActive(id);
  }
}
```

Create `helados-api/src/flavors/flavors.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { FlavorsService } from './flavors.service';
import { FlavorsController } from './flavors.controller';

@Module({
  providers: [FlavorsService],
  controllers: [FlavorsController],
})
export class FlavorsModule {}
```

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, ProductsModule, FlavorsModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run full tests and commit**

```bash
npm test 2>&1 | tail -10
git add helados-api/src/flavors/ helados-api/src/app.module.ts
git commit -m "feat: add flavors module (CRUD + toggle-active)"
```

---

## Task 4: Toppings module (NestJS)

**Files:**
- Create: `helados-api/src/toppings/dto/create-topping.dto.ts`
- Create: `helados-api/src/toppings/dto/update-topping.dto.ts`
- Create: `helados-api/src/toppings/toppings.service.ts`
- Create: `helados-api/src/toppings/toppings.service.spec.ts`
- Create: `helados-api/src/toppings/toppings.controller.ts`
- Create: `helados-api/src/toppings/toppings.module.ts`
- Modify: `helados-api/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/toppings/dto/create-topping.dto.ts`:
```typescript
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateToppingDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
```

Create `helados-api/src/toppings/dto/update-topping.dto.ts`:
```typescript
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateToppingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
```

- [ ] **Step 2: Write failing test**

Create `helados-api/src/toppings/toppings.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ToppingsService } from './toppings.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  topping: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockTopping = {
  id: 'tid-1', name: 'Oreo', unitPrice: 0.75, imageUrl: null, active: true,
};

describe('ToppingsService', () => {
  let service: ToppingsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ToppingsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ToppingsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll filters to active by default', async () => {
    mockPrisma.topping.findMany.mockResolvedValue([mockTopping]);
    await service.findAll();
    expect(mockPrisma.topping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('toggleActive flips active flag', async () => {
    mockPrisma.topping.findUnique.mockResolvedValue(mockTopping);
    mockPrisma.topping.update.mockResolvedValue({ ...mockTopping, active: false });
    await service.toggleActive('tid-1');
    expect(mockPrisma.topping.update).toHaveBeenCalledWith({
      where: { id: 'tid-1' }, data: { active: false },
    });
  });

  it('toggleActive throws NotFoundException for unknown id', async () => {
    mockPrisma.topping.findUnique.mockResolvedValue(null);
    await expect(service.toggleActive('bad')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=toppings.service 2>&1 | tail -10
```

Expected: FAIL

- [ ] **Step 4: Implement ToppingsService**

Create `helados-api/src/toppings/toppings.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateToppingDto } from './dto/create-topping.dto';
import { UpdateToppingDto } from './dto/update-topping.dto';

@Injectable()
export class ToppingsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.topping.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateToppingDto) {
    return this.prisma.topping.create({ data: dto });
  }

  async update(id: string, dto: UpdateToppingDto) {
    const topping = await this.prisma.topping.findUnique({ where: { id } });
    if (!topping) throw new NotFoundException(`Topping ${id} not found`);
    return this.prisma.topping.update({ where: { id }, data: dto });
  }

  async toggleActive(id: string) {
    const topping = await this.prisma.topping.findUnique({ where: { id } });
    if (!topping) throw new NotFoundException(`Topping ${id} not found`);
    return this.prisma.topping.update({ where: { id }, data: { active: !topping.active } });
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=toppings.service 2>&1 | tail -10
```

Expected: PASS — 3 tests

- [ ] **Step 6: Create ToppingsController and ToppingsModule**

Create `helados-api/src/toppings/toppings.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ToppingsService } from './toppings.service';
import { CreateToppingDto } from './dto/create-topping.dto';
import { UpdateToppingDto } from './dto/update-topping.dto';

@Controller('toppings')
@UseGuards(JwtAuthGuard)
export class ToppingsController {
  constructor(private toppings: ToppingsService) {}

  @Get()
  findAll(@Request() req: { user: { role: string } }) {
    return this.toppings.findAll(req.user.role === 'ADMIN');
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateToppingDto) {
    return this.toppings.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateToppingDto) {
    return this.toppings.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  toggleActive(@Param('id') id: string) {
    return this.toppings.toggleActive(id);
  }
}
```

Create `helados-api/src/toppings/toppings.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ToppingsService } from './toppings.service';
import { ToppingsController } from './toppings.controller';

@Module({
  providers: [ToppingsService],
  controllers: [ToppingsController],
})
export class ToppingsModule {}
```

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';
import { ToppingsModule } from './toppings/toppings.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, ProductsModule, FlavorsModule, ToppingsModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run full tests and commit**

```bash
npm test 2>&1 | tail -10
git add helados-api/src/toppings/ helados-api/src/app.module.ts
git commit -m "feat: add toppings module (CRUD + toggle-active)"
```

---

## Task 5: Coupons module (NestJS)

**Files:**
- Create: `helados-api/src/coupons/dto/create-coupon.dto.ts`
- Create: `helados-api/src/coupons/dto/validate-coupon.dto.ts`
- Create: `helados-api/src/coupons/coupons.service.ts`
- Create: `helados-api/src/coupons/coupons.service.spec.ts`
- Create: `helados-api/src/coupons/coupons.controller.ts`
- Create: `helados-api/src/coupons/coupons.module.ts`
- Modify: `helados-api/src/app.module.ts`

**Note:** The `validate` endpoint is the most business-critical piece here — it checks active, date range, and max uses, returning 422 with a human-readable Spanish message on each failure.

- [ ] **Step 1: Create DTOs**

Create `helados-api/src/coupons/dto/create-coupon.dto.ts`:
```typescript
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCouponDto {
  @IsString()
  code: string;

  @IsEnum(['PERCENTAGE', 'FIXED'])
  discountType: 'PERCENTAGE' | 'FIXED';

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discountValue: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxUses?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
```

Create `helados-api/src/coupons/dto/validate-coupon.dto.ts`:
```typescript
import { IsString } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  code: string;
}
```

- [ ] **Step 2: Write failing test (focus on validate logic)**

Create `helados-api/src/coupons/coupons.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  coupon: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const validCoupon = {
  id: 'cid-1',
  code: 'SAVE10',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  maxUses: null,
  usesCount: 0,
  validFrom: null,
  validUntil: null,
  active: true,
};

describe('CouponsService', () => {
  let service: CouponsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CouponsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CouponsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('validate throws 422 for unknown code', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(null);
    await expect(service.validate('BADCODE')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 for inactive coupon', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, active: false });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 when coupon has not started yet', async () => {
    const future = new Date(Date.now() + 86_400_000);
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, validFrom: future });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 for expired coupon', async () => {
    const past = new Date(Date.now() - 86_400_000);
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, validUntil: past });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate throws 422 when max uses reached', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue({ ...validCoupon, maxUses: 5, usesCount: 5 });
    await expect(service.validate('SAVE10')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('validate returns discount info for a valid coupon', async () => {
    mockPrisma.coupon.findUnique.mockResolvedValue(validCoupon);
    const result = await service.validate('SAVE10');
    expect(result).toMatchObject({
      id: 'cid-1',
      code: 'SAVE10',
      discountType: 'PERCENTAGE',
      discountValue: 10,
    });
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=coupons.service 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './coupons.service'`

- [ ] **Step 4: Implement CouponsService**

Create `helados-api/src/coupons/coupons.service.ts`:
```typescript
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.coupon.findMany({ orderBy: { code: 'asc' } });
  }

  create(dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: {
        ...dto,
        code: dto.code.toUpperCase(),
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  async deactivate(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException(`Coupon ${id} not found`);
    return this.prisma.coupon.update({ where: { id }, data: { active: false } });
  }

  async validate(code: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!coupon || !coupon.active) {
      throw new UnprocessableEntityException('Cupón inválido o inactivo');
    }

    const now = new Date();
    if (coupon.validFrom && coupon.validFrom > now) {
      throw new UnprocessableEntityException('El cupón aún no es válido');
    }
    if (coupon.validUntil && coupon.validUntil < now) {
      throw new UnprocessableEntityException('El cupón ha expirado');
    }
    if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
      throw new UnprocessableEntityException('El cupón ha alcanzado su límite de usos');
    }

    return {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
    };
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- --testPathPattern=coupons.service 2>&1 | tail -10
```

Expected: PASS — 6 tests

- [ ] **Step 6: Create CouponsController and CouponsModule**

Create `helados-api/src/coupons/coupons.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private coupons: CouponsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll() {
    return this.coupons.findAll();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @Patch(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deactivate(@Param('id') id: string) {
    return this.coupons.deactivate(id);
  }

  @Post('validate')
  validate(@Body() dto: ValidateCouponDto) {
    return this.coupons.validate(dto.code);
  }
}
```

Create `helados-api/src/coupons/coupons.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';

@Module({
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
```

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';
import { ToppingsModule } from './toppings/toppings.module';
import { CouponsModule } from './coupons/coupons.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, ProductsModule, FlavorsModule, ToppingsModule, CouponsModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run full tests and commit**

```bash
npm test 2>&1 | tail -10
git add helados-api/src/coupons/ helados-api/src/app.module.ts
git commit -m "feat: add coupons module (CRUD + validate with 422 error messages)"
```

---

## Task 6: Images module (Cloudinary)

**Files:**
- Create: `helados-api/src/images/images.service.ts`
- Create: `helados-api/src/images/images.controller.ts`
- Create: `helados-api/src/images/images.module.ts`
- Modify: `helados-api/.env.example`
- Modify: `helados-api/.env`
- Modify: `helados-api/src/app.module.ts`

**Note:** Cloudinary credentials are needed for this to work in production. For local dev without real credentials, the upload endpoint will fail gracefully — that's fine. We do NOT write unit tests for this module because it wraps an external service.

- [ ] **Step 1: Install dependencies**

```bash
cd helados-api
npm install cloudinary streamifier
npm install --save-dev @types/streamifier
```

- [ ] **Step 2: Create ImagesService**

Create `helados-api/src/images/images.service.ts`:
```typescript
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class ImagesService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  upload(buffer: Buffer, folder = 'helados'): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder },
        (error, result) => {
          if (error || !result) reject(new InternalServerErrorException('Image upload failed'));
          else resolve(result.secure_url);
        },
      );
      streamifier.createReadStream(buffer).pipe(stream);
    });
  }
}
```

- [ ] **Step 3: Create ImagesController**

Create `helados-api/src/images/images.controller.ts`:
```typescript
import {
  Controller, Post, UploadedFile, UseGuards, UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ImagesService } from './images.service';

@Controller('images')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ImagesController {
  constructor(private images: ImagesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const url = await this.images.upload(file.buffer);
    return { url };
  }
}
```

- [ ] **Step 4: Create ImagesModule**

Create `helados-api/src/images/images.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ImagesService } from './images.service';
import { ImagesController } from './images.controller';

@Module({
  providers: [ImagesService],
  controllers: [ImagesController],
})
export class ImagesModule {}
```

- [ ] **Step 5: Update environment files**

Add to `helados-api/.env.example`:
```
DATABASE_URL=postgresql://helados:helados@localhost:5432/helados_dev
JWT_SECRET=dev-secret-change-in-production
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Also add the three Cloudinary vars to `helados-api/.env` (use placeholder values for now):
```
CLOUDINARY_CLOUD_NAME=placeholder
CLOUDINARY_API_KEY=placeholder
CLOUDINARY_API_SECRET=placeholder
```

- [ ] **Step 6: Register in AppModule**

Replace `helados-api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';
import { ToppingsModule } from './toppings/toppings.module';
import { CouponsModule } from './coupons/coupons.module';
import { ImagesModule } from './images/images.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, ProductsModule, FlavorsModule, ToppingsModule, CouponsModule, ImagesModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run full tests and confirm no regressions**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests still pass (images module has no tests — that's intentional).

- [ ] **Step 8: Commit**

```bash
git add helados-api/src/images/ helados-api/src/app.module.ts helados-api/.env.example
git commit -m "feat: add Cloudinary image upload endpoint (POST /images/upload)"
```

---

## Task 7: Angular models and HTTP services

**Files:**
- Create: `helados-ui/src/app/core/models/product.model.ts`
- Create: `helados-ui/src/app/core/models/flavor.model.ts`
- Create: `helados-ui/src/app/core/models/topping.model.ts`
- Create: `helados-ui/src/app/core/models/coupon.model.ts`
- Create: `helados-ui/src/app/core/models/user.model.ts`
- Create: `helados-ui/src/app/core/services/product.service.ts`
- Create: `helados-ui/src/app/core/services/flavor.service.ts`
- Create: `helados-ui/src/app/core/services/topping.service.ts`
- Create: `helados-ui/src/app/core/services/coupon.service.ts`
- Create: `helados-ui/src/app/core/services/user-admin.service.ts`

**Context:** All services use `inject(HttpClient)` and `environment.apiUrl`. `HttpClient` is already provided via `provideHttpClient(withInterceptors([authInterceptor]))` in `app.config.ts` from Plan 1. The auth interceptor automatically attaches the Bearer token, so no manual headers needed here.

- [ ] **Step 1: Create model types**

Create `helados-ui/src/app/core/models/product.model.ts`:
```typescript
export type ProductType = 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL';
export type ProductSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  size: ProductSize;
  basePrice: number;
  imageUrl?: string;
  active: boolean;
  createdAt: string;
}

export interface CreateProductPayload {
  name: string;
  type: ProductType;
  size: ProductSize;
  basePrice: number;
  imageUrl?: string;
}
```

Create `helados-ui/src/app/core/models/flavor.model.ts`:
```typescript
export interface Flavor {
  id: string;
  name: string;
  priceModifier: number;
  imageUrl?: string;
  active: boolean;
}

export interface CreateFlavorPayload {
  name: string;
  priceModifier: number;
  imageUrl?: string;
}
```

Create `helados-ui/src/app/core/models/topping.model.ts`:
```typescript
export interface Topping {
  id: string;
  name: string;
  unitPrice: number;
  imageUrl?: string;
  active: boolean;
}

export interface CreateToppingPayload {
  name: string;
  unitPrice: number;
  imageUrl?: string;
}
```

Create `helados-ui/src/app/core/models/coupon.model.ts`:
```typescript
export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Coupon {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxUses: number | null;
  usesCount: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export interface CreateCouponPayload {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxUses?: number;
  validFrom?: string;
  validUntil?: string;
}

export interface CouponValidation {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
}
```

Create `helados-ui/src/app/core/models/user.model.ts`:
```typescript
export type Role = 'STAFF' | 'ADMIN';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: Role;
  password: string;
}
```

- [ ] **Step 2: Create HTTP services**

Create `helados-ui/src/app/core/services/product.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Product, CreateProductPayload } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/products`;

  getAll() { return this.http.get<Product[]>(this.url); }
  create(body: CreateProductPayload) { return this.http.post<Product>(this.url, body); }
  update(id: string, body: Partial<CreateProductPayload>) { return this.http.patch<Product>(`${this.url}/${id}`, body); }
  toggleActive(id: string) { return this.http.patch<Product>(`${this.url}/${id}/toggle-active`, {}); }
}
```

Create `helados-ui/src/app/core/services/flavor.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Flavor, CreateFlavorPayload } from '../models/flavor.model';

@Injectable({ providedIn: 'root' })
export class FlavorService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/flavors`;

  getAll() { return this.http.get<Flavor[]>(this.url); }
  create(body: CreateFlavorPayload) { return this.http.post<Flavor>(this.url, body); }
  update(id: string, body: Partial<CreateFlavorPayload>) { return this.http.patch<Flavor>(`${this.url}/${id}`, body); }
  toggleActive(id: string) { return this.http.patch<Flavor>(`${this.url}/${id}/toggle-active`, {}); }
}
```

Create `helados-ui/src/app/core/services/topping.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Topping, CreateToppingPayload } from '../models/topping.model';

@Injectable({ providedIn: 'root' })
export class ToppingService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/toppings`;

  getAll() { return this.http.get<Topping[]>(this.url); }
  create(body: CreateToppingPayload) { return this.http.post<Topping>(this.url, body); }
  update(id: string, body: Partial<CreateToppingPayload>) { return this.http.patch<Topping>(`${this.url}/${id}`, body); }
  toggleActive(id: string) { return this.http.patch<Topping>(`${this.url}/${id}/toggle-active`, {}); }
}
```

Create `helados-ui/src/app/core/services/coupon.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Coupon, CreateCouponPayload, CouponValidation } from '../models/coupon.model';

@Injectable({ providedIn: 'root' })
export class CouponService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/coupons`;

  getAll() { return this.http.get<Coupon[]>(this.url); }
  create(body: CreateCouponPayload) { return this.http.post<Coupon>(this.url, body); }
  deactivate(id: string) { return this.http.patch<Coupon>(`${this.url}/${id}/deactivate`, {}); }
  validate(code: string) { return this.http.post<CouponValidation>(`${this.url}/validate`, { code }); }
}
```

Create `helados-ui/src/app/core/services/user-admin.service.ts`:
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AppUser, CreateUserPayload, Role } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}/users`;

  getAll() { return this.http.get<AppUser[]>(this.url); }
  create(body: CreateUserPayload) { return this.http.post<AppUser>(this.url, body); }
  changeRole(id: string, role: Role) { return this.http.patch<AppUser>(`${this.url}/${id}/role`, { role }); }
  deactivate(id: string) { return this.http.patch<AppUser>(`${this.url}/${id}/deactivate`, {}); }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -15
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/core/models/ helados-ui/src/app/core/services/
git commit -m "feat: add Angular models and HTTP services for catalog, coupons, users"
```

---

## Task 8: Angular image upload component (shared)

**Files:**
- Create: `helados-ui/src/app/shared/components/image-upload/image-upload.component.ts`
- Create: `helados-ui/src/app/shared/components/image-upload/image-upload.component.html`

**Context:** This component accepts a `currentImageUrl` input and emits the uploaded Cloudinary URL via an `uploaded` output. It calls `POST /images/upload` with `multipart/form-data`. The auth interceptor attaches the token automatically. Note: `HttpClient` does NOT set a Content-Type header for FormData — let the browser set the multipart boundary.

- [ ] **Step 1: Create the component**

Create `helados-ui/src/app/shared/components/image-upload/image-upload.component.ts`:
```typescript
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-image-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-upload.component.html',
})
export class ImageUploadComponent {
  @Input() currentImageUrl?: string;
  @Output() uploaded = new EventEmitter<string>();

  private http = inject(HttpClient);

  loading = false;
  error = '';

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.loading = true;
    this.error = '';

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<{ url: string }>(`${environment.apiUrl}/images/upload`, formData).subscribe({
      next: (res) => {
        this.loading = false;
        this.uploaded.emit(res.url);
      },
      error: () => {
        this.loading = false;
        this.error = 'Error al subir imagen';
      },
    });
  }
}
```

Create `helados-ui/src/app/shared/components/image-upload/image-upload.component.html`:
```html
<div class="space-y-2">
  @if (currentImageUrl) {
    <img [src]="currentImageUrl" alt="Preview" class="h-24 w-24 object-cover rounded-lg border border-gray-700" />
  } @else {
    <div class="h-24 w-24 bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-center text-3xl">🍦</div>
  }

  <label class="cursor-pointer inline-block">
    <span class="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
      {{ loading ? 'Subiendo...' : 'Seleccionar imagen' }}
    </span>
    <input
      type="file"
      accept="image/*"
      class="sr-only"
      [disabled]="loading"
      (change)="onFileSelected($event)"
    />
  </label>

  @if (error) {
    <p class="text-red-400 text-xs">{{ error }}</p>
  }
</div>
```

- [ ] **Step 2: Build to verify**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd ..
git add helados-ui/src/app/shared/
git commit -m "feat: add shared image upload component (Cloudinary)"
```

---

## Task 9: Angular Catalog page (Products / Flavors / Toppings tabs)

**Files:**
- Modify: `helados-ui/src/app/features/catalog/catalog.component.ts` (replaces Plan 1 stub)
- Create: `helados-ui/src/app/features/catalog/catalog.component.html`

**Context:** The Catalog page has 3 tabs. Each tab shows a card grid of items (image, name, price, active badge). A floating "+ Agregar" button opens an inline form panel. Tapping "Editar" on a card pre-fills the form. Tapping "Activar/Desactivar" calls `toggleActive`. All mutation operations reload the list. The form has: name, price, type+size (products only), image upload. Uses `ImageUploadComponent`.

- [ ] **Step 1: Replace the stub CatalogComponent**

Replace `helados-ui/src/app/features/catalog/catalog.component.ts`:
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../../core/services/product.service';
import { FlavorService } from '../../core/services/flavor.service';
import { ToppingService } from '../../core/services/topping.service';
import { ImageUploadComponent } from '../../shared/components/image-upload/image-upload.component';
import { Product, ProductType, ProductSize } from '../../core/models/product.model';
import { Flavor } from '../../core/models/flavor.model';
import { Topping } from '../../core/models/topping.model';

type Tab = 'products' | 'flavors' | 'toppings';
type CatalogItem = (Product | Flavor | Topping) & { basePrice?: number; priceModifier?: number; unitPrice?: number };

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageUploadComponent],
  templateUrl: './catalog.component.html',
})
export class CatalogComponent implements OnInit {
  private productSvc = inject(ProductService);
  private flavorSvc = inject(FlavorService);
  private toppingSvc = inject(ToppingService);

  activeTab: Tab = 'products';
  products: Product[] = [];
  flavors: Flavor[] = [];
  toppings: Topping[] = [];
  loading = false;
  saving = false;
  error = '';

  showForm = false;
  editingId: string | null = null;

  form = {
    name: '',
    basePrice: 0,
    priceModifier: 0,
    unitPrice: 0,
    type: 'CONE' as ProductType,
    size: 'SMALL' as ProductSize,
    imageUrl: '',
  };

  productTypes: ProductType[] = ['CONE', 'CONTAINER', 'CUP', 'BOWL'];
  productSizes: ProductSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

  readonly tabs = [
    { key: 'products' as Tab, label: 'Productos' },
    { key: 'flavors' as Tab, label: 'Sabores' },
    { key: 'toppings' as Tab, label: 'Toppings' },
  ];

  ngOnInit() { this.loadAll(); }

  loadAll() {
    this.loading = true;
    this.productSvc.getAll().subscribe({ next: p => this.products = p, error: () => {} });
    this.flavorSvc.getAll().subscribe({ next: f => this.flavors = f, error: () => {} });
    this.toppingSvc.getAll().subscribe({ next: t => { this.toppings = t; this.loading = false; }, error: () => { this.loading = false; } });
  }

  get currentItems(): CatalogItem[] {
    if (this.activeTab === 'products') return this.products;
    if (this.activeTab === 'flavors') return this.flavors;
    return this.toppings;
  }

  priceLabel(item: CatalogItem): string {
    const price = item.basePrice ?? item.priceModifier ?? item.unitPrice ?? 0;
    return `$${Number(price).toFixed(2)}`;
  }

  openCreate() {
    this.editingId = null;
    this.form = { name: '', basePrice: 0, priceModifier: 0, unitPrice: 0, type: 'CONE', size: 'SMALL', imageUrl: '' };
    this.error = '';
    this.showForm = true;
  }

  openEdit(item: CatalogItem) {
    this.editingId = item.id;
    this.form = {
      name: item.name,
      basePrice: Number((item as Product).basePrice ?? 0),
      priceModifier: Number((item as Flavor).priceModifier ?? 0),
      unitPrice: Number((item as Topping).unitPrice ?? 0),
      type: (item as Product).type ?? 'CONE',
      size: (item as Product).size ?? 'SMALL',
      imageUrl: item.imageUrl ?? '',
    };
    this.error = '';
    this.showForm = true;
  }

  onImageUploaded(url: string) { this.form.imageUrl = url; }

  save() {
    this.saving = true;
    this.error = '';

    const obs = this.activeTab === 'products'
      ? (this.editingId
          ? this.productSvc.update(this.editingId, { name: this.form.name, type: this.form.type, size: this.form.size, basePrice: this.form.basePrice, imageUrl: this.form.imageUrl || undefined })
          : this.productSvc.create({ name: this.form.name, type: this.form.type, size: this.form.size, basePrice: this.form.basePrice, imageUrl: this.form.imageUrl || undefined }))
      : this.activeTab === 'flavors'
        ? (this.editingId
            ? this.flavorSvc.update(this.editingId, { name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined })
            : this.flavorSvc.create({ name: this.form.name, priceModifier: this.form.priceModifier, imageUrl: this.form.imageUrl || undefined }))
        : (this.editingId
            ? this.toppingSvc.update(this.editingId, { name: this.form.name, unitPrice: this.form.unitPrice, imageUrl: this.form.imageUrl || undefined })
            : this.toppingSvc.create({ name: this.form.name, unitPrice: this.form.unitPrice, imageUrl: this.form.imageUrl || undefined }));

    obs.subscribe({
      next: () => { this.saving = false; this.showForm = false; this.loadAll(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al guardar'; },
    });
  }

  toggleActive(item: CatalogItem) {
    const obs = this.activeTab === 'products'
      ? this.productSvc.toggleActive(item.id)
      : this.activeTab === 'flavors'
        ? this.flavorSvc.toggleActive(item.id)
        : this.toppingSvc.toggleActive(item.id);
    obs.subscribe({ next: () => this.loadAll(), error: () => {} });
  }
}
```

- [ ] **Step 2: Create the template**

Create `helados-ui/src/app/features/catalog/catalog.component.html`:
```html
<div class="min-h-screen bg-gray-950 p-6">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-white">Catálogo</h1>
    <button (click)="openCreate()" class="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-xl touch-manipulation">
      + Agregar
    </button>
  </div>

  <!-- Tabs -->
  <div class="flex gap-2 mb-6">
    @for (tab of tabs; track tab.key) {
      <button
        (click)="activeTab = tab.key; showForm = false"
        class="px-6 py-2.5 rounded-xl font-medium transition-colors touch-manipulation"
        [class.bg-purple-600]="activeTab === tab.key"
        [class.text-white]="activeTab === tab.key"
        [class.bg-gray-800]="activeTab !== tab.key"
        [class.text-gray-400]="activeTab !== tab.key"
      >{{ tab.label }}</button>
    }
  </div>

  @if (loading) {
    <p class="text-gray-400">Cargando...</p>
  } @else {
    <!-- Card grid -->
    <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))">
      @for (item of currentItems; track item.id) {
        <div
          class="bg-gray-900 rounded-2xl overflow-hidden border transition-colors"
          [class.border-gray-700]="item.active"
          [class.border-red-900]="!item.active"
        >
          @if (item.imageUrl) {
            <img [src]="item.imageUrl" [alt]="item.name" class="w-full h-32 object-cover" />
          } @else {
            <div class="w-full h-32 bg-gray-800 flex items-center justify-center text-4xl">🍦</div>
          }

          <div class="p-3">
            <p class="font-bold text-white text-sm truncate">{{ item.name }}</p>
            <p class="text-purple-400 text-sm mt-0.5">{{ priceLabel(item) }}</p>
            @if (!item.active) {
              <span class="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded mt-1 inline-block">Inactivo</span>
            }
          </div>

          <div class="px-3 pb-3 flex gap-2">
            <button
              (click)="openEdit(item)"
              class="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg touch-manipulation"
            >Editar</button>
            <button
              (click)="toggleActive(item)"
              class="flex-1 text-xs py-2 rounded-lg touch-manipulation"
              [class.bg-red-900]="item.active" [class.text-red-300]="item.active"
              [class.bg-green-900]="!item.active" [class.text-green-300]="!item.active"
            >{{ item.active ? 'Desactivar' : 'Activar' }}</button>
          </div>
        </div>
      }
    </div>
  }

  <!-- Form panel (modal overlay) -->
  @if (showForm) {
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" (click.self)="showForm = false">
      <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
        <h2 class="text-lg font-bold text-white">{{ editingId ? 'Editar' : 'Agregar' }} {{ activeTab === 'products' ? 'Producto' : activeTab === 'flavors' ? 'Sabor' : 'Topping' }}</h2>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Nombre</label>
          <input [(ngModel)]="form.name" type="text" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>

        @if (activeTab === 'products') {
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm text-gray-300 mb-1">Tipo</label>
              <select [(ngModel)]="form.type" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
                @for (t of productTypes; track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </div>
            <div>
              <label class="block text-sm text-gray-300 mb-1">Tamaño</label>
              <select [(ngModel)]="form.size" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
                @for (s of productSizes; track s) {
                  <option [value]="s">{{ s }}</option>
                }
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Precio base ($)</label>
            <input [(ngModel)]="form.basePrice" type="number" min="0" step="0.01" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        }

        @if (activeTab === 'flavors') {
          <div>
            <label class="block text-sm text-gray-300 mb-1">Modificador de precio ($)</label>
            <input [(ngModel)]="form.priceModifier" type="number" min="0" step="0.01" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        }

        @if (activeTab === 'toppings') {
          <div>
            <label class="block text-sm text-gray-300 mb-1">Precio por unidad ($)</label>
            <input [(ngModel)]="form.unitPrice" type="number" min="0" step="0.01" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        }

        <div>
          <label class="block text-sm text-gray-300 mb-1">Imagen</label>
          <app-image-upload
            [currentImageUrl]="form.imageUrl || undefined"
            (uploaded)="onImageUploaded($event)"
          />
        </div>

        @if (error) {
          <p class="text-red-400 text-sm">{{ error }}</p>
        }

        <div class="flex gap-3 pt-2">
          <button (click)="showForm = false" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl touch-manipulation">Cancelar</button>
          <button (click)="save()" [disabled]="saving" class="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl touch-manipulation">
            {{ saving ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </div>
    </div>
  }
</div>
```

- [ ] **Step 3: Build to verify**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -15
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd ..
git add helados-ui/src/app/features/catalog/
git commit -m "feat: replace Catalog stub with full 3-tab CRUD page"
```

---

## Task 10: Angular Coupons page

**Files:**
- Modify: `helados-ui/src/app/features/coupons/coupons.component.ts` (replaces Plan 1 stub)
- Create: `helados-ui/src/app/features/coupons/coupons.component.html`

- [ ] **Step 1: Replace CouponsComponent**

Replace `helados-ui/src/app/features/coupons/coupons.component.ts`:
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CouponService } from '../../core/services/coupon.service';
import { Coupon, CreateCouponPayload } from '../../core/models/coupon.model';

@Component({
  selector: 'app-coupons',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './coupons.component.html',
})
export class CouponsComponent implements OnInit {
  private couponSvc = inject(CouponService);

  coupons: Coupon[] = [];
  loading = false;
  saving = false;
  error = '';
  showForm = false;

  form: CreateCouponPayload = {
    code: '',
    discountType: 'PERCENTAGE',
    discountValue: 0,
  };

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.couponSvc.getAll().subscribe({
      next: (c) => { this.coupons = c; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.form = { code: '', discountType: 'PERCENTAGE', discountValue: 0 };
    this.error = '';
    this.showForm = true;
  }

  save() {
    this.saving = true;
    this.error = '';
    this.couponSvc.create(this.form).subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al crear'; },
    });
  }

  deactivate(coupon: Coupon) {
    this.couponSvc.deactivate(coupon.id).subscribe({ next: () => this.load(), error: () => {} });
  }

  discountLabel(coupon: Coupon): string {
    return coupon.discountType === 'PERCENTAGE'
      ? `${coupon.discountValue}%`
      : `$${Number(coupon.discountValue).toFixed(2)}`;
  }
}
```

- [ ] **Step 2: Create template**

Create `helados-ui/src/app/features/coupons/coupons.component.html`:
```html
<div class="min-h-screen bg-gray-950 p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-white">Cupones</h1>
    <button (click)="openCreate()" class="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-xl touch-manipulation">
      + Nuevo cupón
    </button>
  </div>

  @if (loading) {
    <p class="text-gray-400">Cargando...</p>
  } @else {
    <div class="bg-gray-900 rounded-2xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-gray-800">
            <th class="text-left px-4 py-3">Código</th>
            <th class="text-left px-4 py-3">Descuento</th>
            <th class="text-left px-4 py-3">Usos</th>
            <th class="text-left px-4 py-3">Válido hasta</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          @for (coupon of coupons; track coupon.id) {
            <tr class="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td class="px-4 py-3 font-mono font-bold text-white">{{ coupon.code }}</td>
              <td class="px-4 py-3 text-purple-400">{{ discountLabel(coupon) }}</td>
              <td class="px-4 py-3 text-gray-300">{{ coupon.usesCount }} / {{ coupon.maxUses ?? '∞' }}</td>
              <td class="px-4 py-3 text-gray-300">{{ coupon.validUntil ? (coupon.validUntil | date:'dd/MM/yyyy') : '—' }}</td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-1 rounded"
                  [class.bg-green-900]="coupon.active" [class.text-green-300]="coupon.active"
                  [class.bg-gray-700]="!coupon.active" [class.text-gray-400]="!coupon.active">
                  {{ coupon.active ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3">
                @if (coupon.active) {
                  <button (click)="deactivate(coupon)" class="text-xs bg-red-900/50 hover:bg-red-900 text-red-300 px-3 py-1.5 rounded-lg touch-manipulation">
                    Desactivar
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (coupons.length === 0) {
        <p class="text-center text-gray-500 py-8">No hay cupones todavía.</p>
      }
    </div>
  }

  <!-- Create form modal -->
  @if (showForm) {
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" (click.self)="showForm = false">
      <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
        <h2 class="text-lg font-bold text-white">Nuevo cupón</h2>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Código</label>
          <input [(ngModel)]="form.code" type="text" placeholder="VERANO10" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 uppercase" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Tipo</label>
            <select [(ngModel)]="form.discountType" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option value="PERCENTAGE">Porcentaje (%)</option>
              <option value="FIXED">Fijo ($)</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Valor</label>
            <input [(ngModel)]="form.discountValue" type="number" min="0" step="0.01" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Usos máximos (vacío = ilimitado)</label>
          <input [(ngModel)]="form.maxUses" type="number" min="1" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Válido desde</label>
            <input [(ngModel)]="form.validFrom" type="date" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Válido hasta</label>
            <input [(ngModel)]="form.validUntil" type="date" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        </div>

        @if (error) {
          <p class="text-red-400 text-sm">{{ error }}</p>
        }

        <div class="flex gap-3 pt-2">
          <button (click)="showForm = false" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl touch-manipulation">Cancelar</button>
          <button (click)="save()" [disabled]="saving" class="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl touch-manipulation">
            {{ saving ? 'Creando...' : 'Crear' }}
          </button>
        </div>
      </div>
    </div>
  }
</div>
```

- [ ] **Step 3: Build and commit**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -10
cd ..
git add helados-ui/src/app/features/coupons/
git commit -m "feat: replace Coupons stub with full management page"
```

---

## Task 11: Angular Users page

**Files:**
- Modify: `helados-ui/src/app/features/users/users.component.ts` (replaces Plan 1 stub)
- Create: `helados-ui/src/app/features/users/users.component.html`

- [ ] **Step 1: Replace UsersComponent**

Replace `helados-ui/src/app/features/users/users.component.ts`:
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserAdminService } from '../../core/services/user-admin.service';
import { AppUser, CreateUserPayload, Role } from '../../core/models/user.model';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit {
  private userSvc = inject(UserAdminService);

  users: AppUser[] = [];
  loading = false;
  saving = false;
  error = '';
  showForm = false;

  form: CreateUserPayload = { name: '', email: '', role: 'STAFF', password: '' };

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.userSvc.getAll().subscribe({
      next: (u) => { this.users = u; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  openCreate() {
    this.form = { name: '', email: '', role: 'STAFF', password: '' };
    this.error = '';
    this.showForm = true;
  }

  save() {
    this.saving = true;
    this.error = '';
    this.userSvc.create(this.form).subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (err) => { this.saving = false; this.error = err?.error?.message ?? 'Error al crear usuario'; },
    });
  }

  changeRole(user: AppUser) {
    const newRole: Role = user.role === 'ADMIN' ? 'STAFF' : 'ADMIN';
    this.userSvc.changeRole(user.id, newRole).subscribe({ next: () => this.load(), error: () => {} });
  }

  deactivate(user: AppUser) {
    this.userSvc.deactivate(user.id).subscribe({ next: () => this.load(), error: () => {} });
  }
}
```

- [ ] **Step 2: Create template**

Create `helados-ui/src/app/features/users/users.component.html`:
```html
<div class="min-h-screen bg-gray-950 p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-white">Usuarios</h1>
    <button (click)="openCreate()" class="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-xl touch-manipulation">
      + Nuevo usuario
    </button>
  </div>

  @if (loading) {
    <p class="text-gray-400">Cargando...</p>
  } @else {
    <div class="bg-gray-900 rounded-2xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-gray-800">
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Correo</th>
            <th class="text-left px-4 py-3">Rol</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          @for (user of users; track user.id) {
            <tr class="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td class="px-4 py-3 font-medium text-white">{{ user.name }}</td>
              <td class="px-4 py-3 text-gray-300">{{ user.email }}</td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-1 rounded"
                  [class.bg-purple-900]="user.role === 'ADMIN'" [class.text-purple-300]="user.role === 'ADMIN'"
                  [class.bg-gray-700]="user.role === 'STAFF'" [class.text-gray-300]="user.role === 'STAFF'">
                  {{ user.role }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-1 rounded"
                  [class.bg-green-900]="user.active" [class.text-green-300]="user.active"
                  [class.bg-gray-700]="!user.active" [class.text-gray-400]="!user.active">
                  {{ user.active ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-2 justify-end">
                  <button (click)="changeRole(user)" class="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg touch-manipulation">
                    → {{ user.role === 'ADMIN' ? 'STAFF' : 'ADMIN' }}
                  </button>
                  @if (user.active) {
                    <button (click)="deactivate(user)" class="text-xs bg-red-900/50 hover:bg-red-900 text-red-300 px-3 py-1.5 rounded-lg touch-manipulation">
                      Desactivar
                    </button>
                  }
                </div>
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (users.length === 0) {
        <p class="text-center text-gray-500 py-8">No hay usuarios todavía.</p>
      }
    </div>
  }

  <!-- Create form modal -->
  @if (showForm) {
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" (click.self)="showForm = false">
      <div class="bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
        <h2 class="text-lg font-bold text-white">Nuevo usuario</h2>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Nombre</label>
          <input [(ngModel)]="form.name" type="text" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Correo</label>
          <input [(ngModel)]="form.email" type="email" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Rol</label>
          <select [(ngModel)]="form.role" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
            <option value="STAFF">STAFF</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Contraseña temporal</label>
          <input [(ngModel)]="form.password" type="password" class="w-full bg-gray-800 text-white rounded-lg px-3 py-2.5 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>

        @if (error) {
          <p class="text-red-400 text-sm">{{ error }}</p>
        }

        <div class="flex gap-3 pt-2">
          <button (click)="showForm = false" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl touch-manipulation">Cancelar</button>
          <button (click)="save()" [disabled]="saving" class="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl touch-manipulation">
            {{ saving ? 'Creando...' : 'Crear' }}
          </button>
        </div>
      </div>
    </div>
  }
</div>
```

- [ ] **Step 3: Final build and commit**

```bash
cd helados-ui
npx ng build --configuration=development 2>&1 | tail -10
cd ..
git add helados-ui/src/app/features/users/
git commit -m "feat: replace Users stub with full management page"
```

---

## Plan 2 Complete

The app now has:
- **NestJS**: 6 new modules — Users, Products, Flavors, Toppings, Coupons, Images
- **Coupon validation**: 422 errors with Spanish messages for all failure cases
- **Cloudinary**: multipart upload endpoint, returns secure URL
- **Angular**: typed models + HTTP services for all entities
- **Catalog page**: 3-tab grid (Products/Flavors/Toppings) with create/edit modal + image upload + toggle active
- **Coupons page**: table + create form with date range and max uses
- **Users page**: table + create form + change-role + deactivate

**Next:** Plan 3 — Visual 5-step Order flow (product → flavor → toppings → coupon → confirm), Order History page.
