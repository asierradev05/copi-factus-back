import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export enum CreateNoteKind {
  NOTA_CREDITO = 'NOTA_CREDITO',
  NOTA_DEBITO = 'NOTA_DEBITO',
}

export class CreateNoteDto {
  @IsEnum(CreateNoteKind)
  @IsNotEmpty({ message: 'El tipo de nota (NOTA_CREDITO/NOTA_DEBITO) es obligatorio.' })
  kind!: CreateNoteKind;

  @IsString()
  @IsNotEmpty({ message: 'El código de concepto de corrección es obligatorio.' })
  @Matches(/^\d{1,2}$/, {
    message: 'El código de corrección debe ser numérico (1-5).',
  })
  @MaxLength(2, { message: 'El código de corrección no puede superar 2 caracteres.' })
  correctionConceptCode!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,3}$/, {
    message: 'El customizationId debe ser numérico (p.ej. 20/30).',
  })
  customizationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(250, { message: 'La observación no puede superar 250 caracteres.' })
  observation?: string;
}