import { IsEnum, IsString } from 'class-validator';
import { AttachmentEntityType } from './create-attachment.dto';

export class FilterAttachmentDto {
  @IsEnum(AttachmentEntityType)
  entityType: AttachmentEntityType;

  @IsString()
  entityId: string;
}
