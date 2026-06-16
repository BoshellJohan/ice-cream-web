import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum SnapshotPeriod {
  MORNING = 'MORNING',
  NIGHT = 'NIGHT',
}

export class InventoryLineDto {
  @IsOptional()
  @IsEnum(['CONE', 'CONTAINER', 'BEVERAGE'])
  productType?: 'CONE' | 'CONTAINER' | 'BEVERAGE';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE', 'OZ4', 'OZ5', 'OZ6', 'OZ7', 'OZ8'])
  productSize?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsNumber()
  @Min(0)
  quantity: number;
}

export class CreateSnapshotDto {
  @IsEnum(SnapshotPeriod)
  period: SnapshotPeriod;

  @IsDateString()
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InventoryLineDto)
  lines: InventoryLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
