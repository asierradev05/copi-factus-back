import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AttachmentEntityType } from './create-attachment.dto';

export class FilterAttachmentDto {
  @IsOptional()
  @IsEnum(AttachmentEntityType)
  entityType?: AttachmentEntityType;

  @IsOptional()
  @IsString()
  entityId?: string;
}
