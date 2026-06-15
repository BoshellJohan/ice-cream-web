import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateTypeConfigDto {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice: number;
}
