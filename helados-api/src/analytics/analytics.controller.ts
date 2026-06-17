import { Body, Controller, Get, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsDailyQueryDto } from './dto/analytics-daily-query.dto';
import { ReconciliationDto } from './dto/reconciliation.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('summary')
  getSummary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getSummary(query.from, query.to);
  }

  @Get('top-items')
  getTopItems(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getTopItems(query.from, query.to);
  }

  @Get('reconciliation-summary')
  getReconciliationSummary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.getReconciliationSummary(query.from, query.to);
  }

  @Get('daily')
  getDaily(@Query() query: AnalyticsDailyQueryDto) {
    return this.analytics.getDaily(query.date);
  }

  @Get('reconciliation')
  getReconciliation(@Query() query: AnalyticsDailyQueryDto) {
    return this.analytics.getReconciliation(query.date);
  }

  @Put('reconciliation')
  saveReconciliation(
    @Request() req: { user: { sub: string } },
    @Body() dto: ReconciliationDto,
  ) {
    return this.analytics.saveReconciliation(dto.date, dto.actualCash, dto.actualQr, req.user.sub);
  }
}
