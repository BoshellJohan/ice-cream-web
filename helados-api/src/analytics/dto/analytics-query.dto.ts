import { IsDateString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
