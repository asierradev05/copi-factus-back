import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  UNCE_STANDARD_CODES,
  UNCE_UNIT_MEASURE_CODES,
} from '../../common/utils/unce-codes';

/** La DIAN solo admite mayusculas; "kgm" es un error de tipeo razonable. */
const canonicalUnceCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateInvoiceItemDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @IsNotEmpty({ message: 'La descripción del ítem es obligatoria.' })
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
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

  /**
   * Codigo de unidad UN/CE (tabla 3). No es solo numerico: `94` unidad, `75`
   * hora, `MTK` m2, `MTR` metro, `KGM` kilogramo, `OTR` otro.
   */
  @IsOptional()
  @Transform(canonicalUnceCode)
  @IsIn(UNCE_UNIT_MEASURE_CODES, {
    message: `Codigo de unidad UN/CE invalido. Permitidos: ${UNCE_UNIT_MEASURE_CODES.join(', ')}.`,
  })
  unitMeasureCode?: string;

  /**
   * Estandar de identificacion del item (tabla item_code): `999` no
   * estandarizado, `001` GTIN, `020` EAN, `010` UNSPC.
   */
  @IsOptional()
  @Transform(canonicalUnceCode)
  @IsIn(UNCE_STANDARD_CODES, {
    message: `Codigo de estandar invalido. Permitidos: ${UNCE_STANDARD_CODES.join(', ')}.`,
  })
  standardCode?: string;
}

export class CreateInvoiceDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items!: CreateInvoiceItemDto[];
}

export class FilterInvoiceDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

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

export class SendInvoiceEmailDto {
  @IsOptional()
  @IsString()
  to?: string;
}
