import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateToppingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['NORMAL', 'PREMIUM'])
  type?: 'NORMAL' | 'PREMIUM';

  @IsOptional()
  @ValidateIf(o => o.customPrice !== null)
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  customPrice?: number | null;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
