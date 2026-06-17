import { IsDateString } from 'class-validator';

export class AnalyticsDailyQueryDto {
  @IsDateString()
  date: string;
}
