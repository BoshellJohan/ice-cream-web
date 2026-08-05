import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

type AuthedRequest = { user: { sub: string; role: string } };

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  create(@Request() req: AuthedRequest, @Body() dto: CreateOrderDto) {
    return this.orders.create(req.user.sub, dto);
  }

  @Get()
  findAll(@Request() req: AuthedRequest, @Query() query: GetOrdersQueryDto) {
    return this.orders.findAll(req.user, query);
  }

  @Get(':id')
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.findOne(req.user, id);
  }

  @Patch(':id/cancel')
  cancel(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancel(req.user, id, dto.reason);
  }
}
