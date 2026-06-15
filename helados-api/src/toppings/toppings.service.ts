import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateToppingDto } from './dto/create-topping.dto';
import { UpdateToppingDto } from './dto/update-topping.dto';
import { UpdateTypeConfigDto } from './dto/update-type-config.dto';

@Injectable()
export class ToppingsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.topping.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  getTypeConfigs() {
    return this.prisma.toppingTypeConfig.findMany();
  }

  async updateTypeConfig(type: 'NORMAL' | 'PREMIUM', dto: UpdateTypeConfigDto) {
    const config = await this.prisma.toppingTypeConfig.update({
      where: { type },
      data: { unitPrice: dto.unitPrice },
    });
    // Cascade effective price to toppings of this type without a custom override
    await this.prisma.topping.updateMany({
      where: { type, customPrice: null },
      data: { unitPrice: dto.unitPrice },
    });
    return config;
  }

  private async resolveUnitPrice(
    type: 'NORMAL' | 'PREMIUM',
    customPrice: number | null | undefined,
  ): Promise<number> {
    if (customPrice != null) return customPrice;
    const config = await this.prisma.toppingTypeConfig.findUnique({ where: { type } });
    return config ? Number(config.unitPrice) : 0;
  }

  async create(dto: CreateToppingDto) {
    const type = dto.type ?? 'NORMAL';
    const unitPrice = await this.resolveUnitPrice(type, dto.customPrice ?? null);
    return this.prisma.topping.create({
      data: {
        name: dto.name,
        type,
        customPrice: dto.customPrice ?? null,
        unitPrice,
        imageUrl: dto.imageUrl,
      },
    });
  }

  async update(id: string, dto: UpdateToppingDto) {
    const topping = await this.prisma.topping.findUnique({ where: { id } });
    if (!topping) throw new NotFoundException(`Topping ${id} not found`);

    const newType = dto.type ?? topping.type;
    // If customPrice is explicitly in the DTO (even null), use it; otherwise keep existing
    const newCustomPrice = 'customPrice' in dto ? dto.customPrice : topping.customPrice;
    const unitPrice = await this.resolveUnitPrice(newType, newCustomPrice != null ? Number(newCustomPrice) : null);

    return this.prisma.topping.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.active !== undefined && { active: dto.active }),
        type: newType,
        customPrice: newCustomPrice != null ? Number(newCustomPrice) : null,
        unitPrice,
      },
    });
  }

  async toggleActive(id: string) {
    const topping = await this.prisma.topping.findUnique({ where: { id } });
    if (!topping) throw new NotFoundException(`Topping ${id} not found`);
    return this.prisma.topping.update({ where: { id }, data: { active: !topping.active } });
  }
}
