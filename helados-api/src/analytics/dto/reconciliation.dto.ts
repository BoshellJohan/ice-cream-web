import { IsDateString, IsNumber, Min } from 'class-validator';

export class ReconciliationDto {
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0)
  actualCash: number;

  @IsNumber()
  @Min(0)
  actualQr: number;
}
