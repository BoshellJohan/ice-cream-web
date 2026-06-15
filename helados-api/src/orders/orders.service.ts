import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

const orderInclude = {
  items: {
    include: {
      product: { select: { id: true, name: true, type: true, size: true } },
      flavor:  { select: { id: true, name: true } },
      toppings: { include: { topping: { select: { id: true, name: true } } } },
    },
  },
  staff:  { select: { id: true, name: true } },
  coupon: { select: { id: true, code: true } },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private couponsService: CouponsService,
  ) {}

  async create(staffId: string, dto: CreateOrderDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('El pedido debe tener al menos un ítem');
    }

    const productIds = dto.items.map(i => i.productId);
    const flavorIds  = dto.items.map(i => i.flavorId);
    const toppingIds = [...new Set(dto.items.flatMap(i => i.toppings.map(t => t.toppingId)))];

    const [products, flavors, toppings] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds }, active: true } }),
      this.prisma.flavor.findMany({  where: { id: { in: flavorIds  }, active: true } }),
      toppingIds.length
        ? this.prisma.topping.findMany({ where: { id: { in: toppingIds }, active: true } })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p] as const));
    const flavorMap  = new Map(flavors.map(f  => [f.id, f] as const));
    const toppingMap = new Map(toppings.map(t => [t.id, t] as const));

    for (const item of dto.items) {
      if (!productMap.has(item.productId)) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado o inactivo`);
      }
      if (!flavorMap.has(item.flavorId)) {
        throw new NotFoundException(`Sabor ${item.flavorId} no encontrado o inactivo`);
      }
      for (const t of item.toppings) {
        if (!toppingMap.has(t.toppingId)) {
          throw new NotFoundException(`Topping ${t.toppingId} no encontrado o inactivo`);
        }
      }
    }

    const itemTotals: number[] = [];
    let subtotal = 0;

    for (const item of dto.items) {
      const product    = productMap.get(item.productId)!;
      const flavor     = flavorMap.get(item.flavorId)!;
      const itemTotal  = Number(product.basePrice) + Number(flavor.priceModifier);
      const toppingCost = item.toppings.reduce((sum, t) => {
        return sum + Number(toppingMap.get(t.toppingId)!.unitPrice) * t.quantity;
      }, 0);
      itemTotals.push(itemTotal);
      subtotal += itemTotal + toppingCost;
    }

    let couponId: string | undefined;
    let discountAmount = 0;

    if (dto.couponCode) {
      const coupon = await this.couponsService.validate(dto.couponCode);
      couponId = coupon.id;
      discountAmount = coupon.discountType === 'PERCENTAGE'
        ? subtotal * coupon.discountValue / 100
        : Math.min(coupon.discountValue, subtotal);
    }

    subtotal       = Math.round(subtotal       * 100) / 100;
    discountAmount = Math.round(discountAmount * 100) / 100;
    const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          staffId,
          couponId,
          subtotal,
          discountAmount,
          totalAmount,
          notes: dto.notes,
          items: {
            create: dto.items.map((item, idx) => ({
              productId: item.productId,
              flavorId:  item.flavorId,
              itemTotal: itemTotals[idx],
              toppings: {
                create: item.toppings.map(t => ({
                  toppingId: t.toppingId,
                  quantity:  t.quantity,
                })),
              },
            })),
          },
        },
        include: orderInclude,
      });

      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usesCount: { increment: 1 } },
        });
      }

      return order;
    });
  }

  async findAll(query: GetOrdersQueryDto) {
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) {
        const toDate = new Date(query.to);
        toDate.setDate(toDate.getDate() + 1);
        where.createdAt.lte = toDate;
      }
    }
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException(`Pedido ${id} no encontrado`);
    return order;
  }
}
