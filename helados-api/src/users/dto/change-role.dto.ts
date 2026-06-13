import { IsEnum } from 'class-validator';

export class ChangeRoleDto {
  @IsEnum(['STAFF', 'ADMIN'])
  role: 'STAFF' | 'ADMIN';
}
