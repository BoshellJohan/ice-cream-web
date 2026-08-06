import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { CancelReason } from './dto/cancel-order.dto';

/** Ventana en la que un STAFF puede anular su propio pedido. */
export const CANCEL_WINDOW_MS = 15 * 60 * 1000;

const orderInclude = {
  payments: true,
  items: {
    include: {
      product: { select: { id: true, name: true, type: true, size: true, directSale: true } },
      flavor:  { select: { id: true, name: true } },
      toppings: { include: { topping: { select: { id: true, name: true } } } },
    },
  },
  staff:  { select: { id: true, name: true } },
  coupon: { select: { id: true, code: true } },
  cancelledByUser: { select: { id: true, name: true } },
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
    const flavorIds  = dto.items.filter(i => i.flavorId).map(i => i.flavorId!);
    const toppingIds = [...new Set(dto.items.flatMap(i => i.toppings.map(t => t.toppingId)))];

    const [products, flavors, toppings] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds }, active: true } }),
      flavorIds.length
        ? this.prisma.flavor.findMany({ where: { id: { in: flavorIds }, active: true } })
        : Promise.resolve([]),
      toppingIds.length
        ? this.prisma.topping.findMany({ where: { id: { in: toppingIds }, active: true } })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p] as const));
    const flavorMap  = new Map(flavors.map(f  => [f.id, f] as const));
    const toppingMap = new Map(toppings.map(t => [t.id, t] as const));

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado o inactivo`);
      }
      if (product.directSale) {
        if (item.flavorId) {
          throw new BadRequestException(`El producto "${product.name}" es de venta directa y no admite sabor`);
        }
        if (item.toppings.length > 0) {
          throw new BadRequestException(`El producto "${product.name}" es de venta directa y no admite toppings`);
        }
      } else {
        if (!item.flavorId || !flavorMap.has(item.flavorId)) {
          throw new NotFoundException(`Sabor ${item.flavorId ?? '(no especificado)'} no encontrado o inactivo`);
        }
        for (const t of item.toppings) {
          if (!toppingMap.has(t.toppingId)) {
            throw new NotFoundException(`Topping ${t.toppingId} no encontrado o inactivo`);
          }
        }
      }
    }

    const itemTotals: number[] = [];
    let subtotal = 0;

    for (const item of dto.items) {
      const product     = productMap.get(item.productId)!;
      const flavor      = item.flavorId ? flavorMap.get(item.flavorId) : undefined;
      const itemTotal = Number(product.basePrice) + (flavor ? Number(flavor.priceModifier) : 0);

      let remainingFree = product.includedToppingQty ?? 0;
      const toppingCost = item.toppings.reduce((sum, t) => {
        const topping = toppingMap.get(t.toppingId)!;
        if (topping.type === product.includedToppingType && remainingFree > 0) {
          const freeQty    = Math.min(t.quantity, remainingFree);
          const chargedQty = t.quantity - freeQty;
          remainingFree -= freeQty;
          return sum + chargedQty * Number(topping.unitPrice);
        }
        return sum + t.quantity * Number(topping.unitPrice);
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
        ? subtotal * Number(coupon.discountValue) / 100
        : Math.min(Number(coupon.discountValue), subtotal);
    }

    subtotal       = Math.round(subtotal       * 100) / 100;
    discountAmount = Math.round(discountAmount * 100) / 100;
    const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    // Validate payments
    const methods = dto.payments.map(p => p.method);
    if (new Set(methods).size !== methods.length) {
      throw new BadRequestException('No se puede usar el mismo método de pago más de una vez');
    }

    const paymentsTotal = Math.round(dto.payments.reduce((s, p) => s + p.amount, 0) * 100);
    const expectedTotal = Math.round(totalAmount * 100);
    if (paymentsTotal !== expectedTotal) {
      throw new UnprocessableEntityException('La suma de los pagos no coincide con el total del pedido');
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          staffId,
          couponId,
          payments: {
            create: dto.payments.map(p => ({
              paymentMethod: p.method,
              amount:        p.amount,
            })),
          },
          subtotal,
          discountAmount,
          totalAmount,
          notes: dto.notes,
          items: {
            create: dto.items.map((item, idx) => ({
              productId: item.productId,
              flavorId:  item.flavorId ?? null,
              itemTotal: itemTotals[idx],
              toppings: {
                create: item.toppings.map(t => ({
                  toppingId:       t.toppingId,
                  quantity:        t.quantity,
                  unitPriceAtSale: toppingMap.get(t.toppingId)!.unitPrice,
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

  async findAll(user: { sub: string; role: string }, query: GetOrdersQueryDto) {
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
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
    return orders.map((order) => ({
      ...order,
      canCancel: this.computeCanCancel(order, user),
    }));
  }

  async findOne(user: { sub: string; role: string }, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException(`Pedido ${id} no encontrado`);
    return { ...order, canCancel: this.computeCanCancel(order, user) };
  }

  /**
   * Devuelve el mensaje de error si el usuario NO puede anular el pedido,
   * o null si sí puede. Única definición de la regla de permiso.
   */
  private cancelPermissionError(
    order: { staffId: string; createdAt: Date },
    user: { sub: string; role: string },
  ): string | null {
    if (user.role === 'ADMIN') return null;
    if (order.staffId !== user.sub) {
      return 'Solo puedes anular pedidos que registraste tú';
    }
    if (Date.now() - order.createdAt.getTime() > CANCEL_WINDOW_MS) {
      return 'El plazo de 15 minutos para anular este pedido ya venció. Pide a un administrador que lo anule.';
    }
    return null;
  }

  /**
   * true si el usuario puede anular este pedido ahora mismo. Delega en
   * `cancelPermissionError` para no duplicar la regla de permiso.
   */
  private computeCanCancel(
    order: { staffId: string; createdAt: Date; cancelledAt: Date | null },
    user: { sub: string; role: string },
  ): boolean {
    if (order.cancelledAt) return false;
    return this.cancelPermissionError(order, user) === null;
  }

  async cancel(
    user: { sub: string; role: string },
    orderId: string,
    reason: CancelReason,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.cancelledAt) throw new ConflictException('El pedido ya está anulado');

    const permissionError = this.cancelPermissionError(order, user);
    if (permissionError) throw new UnprocessableEntityException(permissionError);

    return this.prisma.$transaction(async (tx) => {
      // El where con cancelledAt: null hace del propio stamp la guarda atómica:
      // si dos solicitudes llegan a la vez, solo una actualiza una fila y la
      // otra recibe count === 0 (evita doble decremento de cupón / auditoría
      // con el usuario o motivo equivocado).
      const stamped = await tx.order.updateMany({
        where: { id: orderId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledBy: user.sub,
          cancelReason: reason,
        },
      });
      if (stamped.count === 0) throw new ConflictException('El pedido ya está anulado');

      if (order.couponId) {
        // updateMany con `usesCount > 0` evita bajar de cero sin leer primero.
        await tx.coupon.updateMany({
          where: { id: order.couponId, usesCount: { gt: 0 } },
          data: { usesCount: { decrement: 1 } },
        });
      }

      const updated = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
      // Un pedido recién anulado nunca vuelve a ser anulable.
      return { ...updated!, canCancel: false };
    });
  }
}
