import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateInvoiceUploadDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  customerId?: string;
}
