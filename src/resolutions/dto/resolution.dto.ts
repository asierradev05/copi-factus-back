import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Ambient, ResolutionType } from '@prisma/client';

export class CreateResolutionDto {
  @IsString()
  @IsNotEmpty({ message: 'El prefijo es obligatorio.' })
  prefix!: string;

  @IsString()
  @IsNotEmpty({ message: 'El número de resolución es obligatorio.' })
  resolutionNumber!: string;

  @Type(() => Number)
  @IsInt({ message: 'El rango inicial debe ser un número entero.' })
  @Min(1)
  from!: number;

  @Type(() => Number)
  @IsInt({ message: 'El rango final debe ser un número entero.' })
  @Min(1)
  to!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  next?: number;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(ResolutionType)
  type?: ResolutionType;

  @IsOptional()
  @IsEnum(Ambient)
  ambient?: Ambient;
}

export class UpdateResolutionDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  resolutionNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  to?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  next?: number;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(ResolutionType)
  type?: ResolutionType;

  @IsOptional()
  @IsEnum(Ambient)
  ambient?: Ambient;

  @IsOptional()
  isActive?: boolean;
}

export class FilterResolutionDto {
  @IsOptional()
  @IsEnum(ResolutionType)
  type?: ResolutionType;

  @IsOptional()
  @IsEnum(Ambient)
  ambient?: Ambient;

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
