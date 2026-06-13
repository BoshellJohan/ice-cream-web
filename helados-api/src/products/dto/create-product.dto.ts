import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL'])
  type: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL';

  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size: 'SMALL' | 'MEDIUM' | 'LARGE';

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
