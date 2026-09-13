import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum CreateNoteKind {
  NOTA_CREDITO = 'NOTA_CREDITO',
  NOTA_DEBITO = 'NOTA_DEBITO',
}

export class CreateNoteDto {
  @IsEnum(CreateNoteKind)
  @IsNotEmpty({
    message: 'El tipo de nota (NOTA_CREDITO/NOTA_DEBITO) es obligatorio.',
  })
  kind!: CreateNoteKind;

  @IsString()
  @IsNotEmpty({
    message: 'El código de concepto de corrección es obligatorio.',
  })
  correctionConceptCode!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customizationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(250, {
    message: 'La observación no puede superar 250 caracteres.',
  })
  observation?: string;
}
