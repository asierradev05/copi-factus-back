import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DocumentType } from '@prisma/client';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  name!: string;

  @IsOptional()
  @IsEnum(DocumentType, { message: 'El tipo de documento no es válido.' })
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  dv?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(2)
  legalOrganizationCode?: number;

  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  phone!: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido.' })
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  municipalityCode?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  tributeCode?: string;

  @IsOptional()
  @IsArray()
  responsibilities?: Array<{ code: string }>;

  @IsOptional()
  @IsString()
  notes?: string;
}
