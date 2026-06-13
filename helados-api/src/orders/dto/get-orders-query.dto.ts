import { IsDateString, IsOptional } from 'class-validator';

export class GetOrdersQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
