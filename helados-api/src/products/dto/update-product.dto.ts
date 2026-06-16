import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'BEVERAGE'])
  type?: 'CONE' | 'CONTAINER' | 'BEVERAGE';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE', 'OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE' | 'OZ4' | 'OZ5' | 'OZ6' | 'OZ7' | 'OZ8';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  directSale?: boolean;

  @ValidateIf(o => o.includedToppingQty != null)
  @IsDefined()
  @IsEnum(['NORMAL', 'PREMIUM'])
  includedToppingType?: 'NORMAL' | 'PREMIUM' | null;

  @ValidateIf(o => o.includedToppingType != null)
  @IsDefined()
  @IsInt()
  @Min(1)
  includedToppingQty?: number | null;
}
