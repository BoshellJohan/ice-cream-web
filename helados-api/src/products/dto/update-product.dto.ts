import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL', 'DRINK'])
  type?: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL' | 'DRINK';

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

  @IsOptional()
  @IsBoolean()
  directSale?: boolean;

  // Both null → clears the allowance. One set without the other → 400.
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
