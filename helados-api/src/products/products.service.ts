import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const CONE_SIZES      = ['SMALL', 'MEDIUM', 'LARGE'];
const CONTAINER_SIZES = ['OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'];

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(includeInactive = false) {
    return this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateProductDto) {
    this.validateTypeSize(dto.type, dto.size);
    const data = dto.type === 'BEVERAGE'
      ? { ...dto, directSale: true }
      : dto;
    return this.prisma.product.create({ data });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    const effectiveType = dto.type ?? product.type;
    const effectiveSize = dto.size ?? (product.size ?? undefined);
    this.validateTypeSize(effectiveType as string, effectiveSize);
    const data = effectiveType === 'BEVERAGE'
      ? { ...dto, directSale: true }
      : dto;
    return this.prisma.product.update({ where: { id }, data });
  }

  async toggleActive(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return this.prisma.product.update({ where: { id }, data: { active: !product.active } });
  }

  private validateTypeSize(type: string, size?: string) {
    if (type === 'BEVERAGE') {
      if (size) throw new BadRequestException('Los productos BEVERAGE no tienen tamaño');
      return;
    }
    if (type === 'CONE') {
      if (!size || !CONE_SIZES.includes(size)) {
        throw new BadRequestException('Los conos requieren tamaño SMALL, MEDIUM o LARGE');
      }
      return;
    }
    if (type === 'CONTAINER') {
      if (!size || !CONTAINER_SIZES.includes(size)) {
        throw new BadRequestException('Los envases requieren tamaño OZ4, OZ5, OZ6, OZ7 u OZ8');
      }
    }
  }
}
