import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @IsUUID()
  invoiceId!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'El monto debe ser numérico.' })
  @Min(0.01, { message: 'El monto debe ser mayor a cero.' })
  amount!: number;

  @IsEnum(PaymentMethod, { message: 'Método de pago no válido.' })
  paymentMethod!: PaymentMethod;

  @IsDateString()
  paymentDate!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class FilterPaymentDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

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
