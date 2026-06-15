import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ToppingsService } from './toppings.service';
import { CreateToppingDto } from './dto/create-topping.dto';
import { UpdateToppingDto } from './dto/update-topping.dto';
import { UpdateTypeConfigDto } from './dto/update-type-config.dto';

@Controller('toppings')
@UseGuards(JwtAuthGuard)
export class ToppingsController {
  constructor(private toppings: ToppingsService) {}

  @Get()
  findAll(@Request() req: { user: { role: string } }) {
    return this.toppings.findAll(req.user.role === 'ADMIN');
  }

  @Get('type-config')
  getTypeConfigs() {
    return this.toppings.getTypeConfigs();
  }

  @Patch('type-config/:type')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateTypeConfig(
    @Param('type') type: 'NORMAL' | 'PREMIUM',
    @Body() dto: UpdateTypeConfigDto,
  ) {
    return this.toppings.updateTypeConfig(type, dto);
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
