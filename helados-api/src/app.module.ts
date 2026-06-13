import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { FlavorsModule } from './flavors/flavors.module';
import { ToppingsModule } from './toppings/toppings.module';
import { CouponsModule } from './coupons/coupons.module';
import { ImagesModule } from './images/images.module';
import { OrdersModule } from './orders/orders.module';
import { InventoryModule } from './inventory/inventory.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    FlavorsModule,
    ToppingsModule,
    CouponsModule,
    ImagesModule,
    OrdersModule,
    InventoryModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
