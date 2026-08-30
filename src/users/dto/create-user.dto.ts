import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio.' })
  fullName!: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres.' })
  password!: string;

  @IsEnum(UserRole, { message: 'El rol no es válido.' })
  role!: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
