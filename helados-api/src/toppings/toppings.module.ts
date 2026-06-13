import { Module } from '@nestjs/common';
import { ToppingsService } from './toppings.service';
import { ToppingsController } from './toppings.controller';

@Module({
  providers: [ToppingsService],
  controllers: [ToppingsController],
})
export class ToppingsModule {}
