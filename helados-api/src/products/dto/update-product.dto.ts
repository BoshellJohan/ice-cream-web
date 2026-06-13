import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL'])
  type?: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
