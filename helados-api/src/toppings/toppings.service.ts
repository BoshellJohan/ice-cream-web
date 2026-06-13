import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateToppingDto } from './dto/create-topping.dto';
import { UpdateToppingDto } from './dto/update-topping.dto';

@Injectable()
export class ToppingsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.topping.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateToppingDto) {
    return this.prisma.topping.create({ data: dto });
  }

  async update(id: string, dto: UpdateToppingDto) {
    const topping = await this.prisma.topping.findUnique({ where: { id } });
    if (!topping) throw new NotFoundException(`Topping ${id} not found`);
    return this.prisma.topping.update({ where: { id }, data: dto });
  }

  async toggleActive(id: string) {
    const topping = await this.prisma.topping.findUnique({ where: { id } });
    if (!topping) throw new NotFoundException(`Topping ${id} not found`);
    return this.prisma.topping.update({ where: { id }, data: { active: !topping.active } });
  }
}
