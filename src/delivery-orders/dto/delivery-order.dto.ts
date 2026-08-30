import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeliveryOrderStatus } from '@prisma/client';

export class CreateDeliveryOrderItemDto {
  @IsString()
  @IsNotEmpty({ message: 'La descripción del ítem es obligatoria.' })
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

export class CreateDeliveryOrderDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryOrderItemDto)
  items!: CreateDeliveryOrderItemDto[];
}

export class UpdateDeliveryOrderStatusDto {
  @IsEnum(DeliveryOrderStatus, {
    message: 'Estado de orden de entrega no válido.',
  })
  status!: DeliveryOrderStatus;
}

export class FilterDeliveryOrderDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsEnum(DeliveryOrderStatus)
  status?: DeliveryOrderStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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
