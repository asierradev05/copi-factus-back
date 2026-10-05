import { Transform, Type } from 'class-transformer';

import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  UNCE_STANDARD_CODES,
  UNCE_UNIT_MEASURE_CODES,
} from '../../common/utils/unce-codes';

/** Mensaje comun: el codigo debe existir en el catalogo UN/CE, no solo tener forma. */
const UNCE_UNIT_MESSAGE = `Codigo de unidad UN/CE invalido. Permitidos: ${UNCE_UNIT_MEASURE_CODES.join(', ')}.`;
const UNCE_STANDARD_MESSAGE = `Codigo de estandar invalido. Permitidos: ${UNCE_STANDARD_CODES.join(', ')}.`;

/**
 * La DIAN solo admite mayusculas, pero "kgm" es un error de tipeo razonable.
 * Se canonicaliza antes de validar para no exigirlo al usuario y no duplicar
 * la normalizacion en el service.
 */
const canonicalCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'El código es obligatorio.' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'El precio unitario debe ser numérico.' })
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;

  /**
   * Codigo de unidad UN/CE (tabla 3). No es solo numerico: `94` unidad, `75`
   * hora, `MTK` m2, `MTR` metro, `KGM` kilogramo, `OTR` otro. Las lineas de
   * factura heredan este valor si no lo sobreescriben.
   */
  @IsOptional()
  @Transform(canonicalCode)
  @IsIn(UNCE_UNIT_MEASURE_CODES, { message: UNCE_UNIT_MESSAGE })
  unitMeasureCode?: string;

  /**
   * Estandar de identificacion del item: `999` no estandarizado, `001` GTIN,
   * `020` EAN, `010` UNSPC.
   */
  @IsOptional()
  @Transform(canonicalCode)
  @IsIn(UNCE_STANDARD_CODES, { message: UNCE_STANDARD_MESSAGE })
  standardCode?: string;

  /** Desactivar no borra: conserva el historial de facturas ya emitidas. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @Transform(canonicalCode)
  @IsIn(UNCE_UNIT_MEASURE_CODES, { message: UNCE_UNIT_MESSAGE })
  unitMeasureCode?: string;

  @IsOptional()
  @Transform(canonicalCode)
  @IsIn(UNCE_STANDARD_CODES, { message: UNCE_STANDARD_MESSAGE })
  standardCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class FilterProductDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100, { message: 'El limite no puede exceder 100.' })
  limit?: number;

  /**
   * Por HTTP el valor llega como texto y el ValidationPipe global tiene
   * `enableImplicitConversion: false`, asi que hay que convertirlo aqui.
   * No se usa `@Type(() => Boolean)` porque `Boolean('false')` es `true` y
   * dejaria el filtro en el estado contrario al pedido.
   */
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    // Cualquier otra cosa se deja como viene para que `@IsBoolean` la rechace.
    return value;
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
