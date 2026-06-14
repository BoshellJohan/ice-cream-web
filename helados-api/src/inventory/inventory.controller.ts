import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InventoryService } from './inventory.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
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
  getSnapshots(@Query() query: GetSnapshotsQueryDto) {
    return this.inventory.getSnapshots(query.date);
  }
}
