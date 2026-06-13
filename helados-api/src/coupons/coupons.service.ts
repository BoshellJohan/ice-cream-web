import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.coupon.findMany({ orderBy: { code: 'asc' } });
  }

  create(dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: {
        ...dto,
        code: dto.code.toUpperCase(),
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  async deactivate(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException(`Coupon ${id} not found`);
    return this.prisma.coupon.update({ where: { id }, data: { active: false } });
  }

  async validate(code: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!coupon || !coupon.active) {
      throw new UnprocessableEntityException('Cupón inválido o inactivo');
    }

    const now = new Date();
    if (coupon.validFrom && coupon.validFrom > now) {
      throw new UnprocessableEntityException('El cupón aún no es válido');
    }
    if (coupon.validUntil && coupon.validUntil < now) {
      throw new UnprocessableEntityException('El cupón ha expirado');
    }
    if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
      throw new UnprocessableEntityException('El cupón ha alcanzado su límite de usos');
    }

    return {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
    };
  }
}
