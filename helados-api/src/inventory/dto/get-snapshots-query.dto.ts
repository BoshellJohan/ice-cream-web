import { IsDateString } from 'class-validator';

export class GetSnapshotsQueryDto {
  @IsDateString()
  date: string;
}
