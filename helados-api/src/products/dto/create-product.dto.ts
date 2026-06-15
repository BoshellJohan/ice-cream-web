import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateIf, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsEnum(['CONE', 'CONTAINER', 'CUP', 'BOWL', 'DRINK'])
  type: 'CONE' | 'CONTAINER' | 'CUP' | 'BOWL' | 'DRINK';

  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size: 'SMALL' | 'MEDIUM' | 'LARGE';

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  directSale?: boolean;

  // Both must be set together or both absent.
  // @ValidateIf triggers when the *other* field is non-null, enforcing co-presence.
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
