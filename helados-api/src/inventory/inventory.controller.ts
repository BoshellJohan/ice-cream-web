import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InventoryService } from './inventory.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
import { UpdateSnapshotDto } from './dto/update-snapshot.dto';
import { GetSnapshotsQueryDto } from './dto/get-snapshots-query.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Post('snapshots')
  upsert(
    @Request() req: { user: { sub: string } },
    @Body() dto: CreateSnapshotDto,
  ) {
    return this.inventory.upsertSnapshot(req.user.sub, dto);
  }

  @Get('snapshots')
  getAll() {
    return this.inventory.findAll();
  }

  @Get('snapshots/day')
  getDay(@Query() query: GetSnapshotsQueryDto) {
    return this.inventory.getSnapshots(query.date);
  }

  @Get('snapshots/:id')
  getOne(@Param('id') id: string) {
    return this.inventory.findOne(id);
  }

  @Patch('snapshots/:id')
  update(
    @Param('id') id: string,
    @Request() req: { user: { sub: string } },
    @Body() dto: UpdateSnapshotDto,
  ) {
    return this.inventory.updateSnapshot(id, req.user.sub, dto);
  }
}
