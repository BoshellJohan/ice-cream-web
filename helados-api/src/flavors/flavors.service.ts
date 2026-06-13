import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlavorDto } from './dto/create-flavor.dto';
import { UpdateFlavorDto } from './dto/update-flavor.dto';

@Injectable()
export class FlavorsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.flavor.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateFlavorDto) {
    return this.prisma.flavor.create({ data: dto });
  }

  async update(id: string, dto: UpdateFlavorDto) {
    const flavor = await this.prisma.flavor.findUnique({ where: { id } });
    if (!flavor) throw new NotFoundException(`Flavor ${id} not found`);
    return this.prisma.flavor.update({ where: { id }, data: dto });
  }

  async toggleActive(id: string) {
    const flavor = await this.prisma.flavor.findUnique({ where: { id } });
    if (!flavor) throw new NotFoundException(`Flavor ${id} not found`);
    return this.prisma.flavor.update({ where: { id }, data: { active: !flavor.active } });
  }
}
