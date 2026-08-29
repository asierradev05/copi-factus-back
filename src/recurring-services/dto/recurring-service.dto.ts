import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RecurringServiceStatus } from '@prisma/client';

export class CreateServiceCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio.' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateServiceSubcategoryDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre de la subcategoría es obligatorio.' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateRecurringServiceDto {
  @IsUUID()
  categoryId!: string;

  @IsUUID()
  subcategoryId!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del servicio es obligatorio.' })
  name!: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'El monto debe ser numérico.' })
  @Min(0)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El día de facturación debe ser un número entero.' })
  @Min(1)
  @Max(31)
  billingDay?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRecurringServiceDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRecurringServiceStatusDto {
  @IsEnum(RecurringServiceStatus, {
    message: 'Estado de servicio recurrente no válido.',
  })
  status!: RecurringServiceStatus;
}

export class FilterRecurringServiceDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  subcategoryId?: string;

  @IsOptional()
  @IsEnum(RecurringServiceStatus)
  status?: RecurringServiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}