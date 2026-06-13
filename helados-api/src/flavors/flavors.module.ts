import { Module } from '@nestjs/common';
import { FlavorsService } from './flavors.service';
import { FlavorsController } from './flavors.controller';

@Module({
  providers: [FlavorsService],
  controllers: [FlavorsController],
})
export class FlavorsModule {}
