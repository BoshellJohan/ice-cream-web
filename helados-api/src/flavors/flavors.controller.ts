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
