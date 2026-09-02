import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePublicInquiryDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(120)
  name!: string;

  @IsPhoneNumber('CO', { message: 'El teléfono no es válido.' })
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  phone!: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo no es válido.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}

const ALLOWED_STATUSES = ['NUEVA', 'CONTACTADA', 'CERRADA'] as const;

export class UpdatePublicInquiryStatusDto {
  @IsIn(ALLOWED_STATUSES, { message: 'El estado no es válido.' })
  status!: (typeof ALLOWED_STATUSES)[number];
}

export class FilterPublicInquiryDto {
  @IsOptional()
  @IsIn(ALLOWED_STATUSES, { message: 'El estado no es válido.' })
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100, { message: 'El límite no puede exceder 100.' })
  limit?: number;
}
