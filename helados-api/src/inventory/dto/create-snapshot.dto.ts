import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum SnapshotPeriod {
  MORNING = 'MORNING',
  NIGHT = 'NIGHT',
}

export class InventoryLineDto {
  @IsOptional()
  @IsUUID()
  flavorId?: string;

  @IsOptional()
  @IsUUID()
  toppingId?: string;

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
