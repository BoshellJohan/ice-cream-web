import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(['STAFF', 'ADMIN'])
  role: 'STAFF' | 'ADMIN';

  @IsString()
  @MinLength(6)
  password: string;
}
