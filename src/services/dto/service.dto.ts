import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ServiceStatus } from '@prisma/client';

export class CreateServiceDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  serviceTypeId!: string;

  @IsString()
  @IsNotEmpty({ message: 'La descripción es obligatoria.' })
  description!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'La cantidad debe ser numérica.' })
  @Min(0.01)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio unitario debe ser numérico.' })
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsDateString()
  requestedAt!: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsUUID()
  serviceTypeId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateServiceStatusDto {
  @IsEnum(ServiceStatus, { message: 'Estado de servicio no válido.' })
  status!: ServiceStatus;
}

export class InvoiceFromServiceDto {
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class FilterServiceDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsEnum(ServiceStatus)
  status?: ServiceStatus;

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
