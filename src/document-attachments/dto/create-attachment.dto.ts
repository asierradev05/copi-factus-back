import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum AttachmentEntityType {
  QUOTE = 'quote',
  PURCHASE_ORDER = 'purchase_order',
  DELIVERY_ORDER = 'delivery_order',
  INVOICE = 'invoice',
}

export class CreateAttachmentDto {
  @IsEnum(AttachmentEntityType)
  @IsNotEmpty()
  entityType: AttachmentEntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  storagePath: string;

  @IsOptional()
  @IsInt()
  fileSize?: number;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
