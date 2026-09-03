import { IsString, IsUUID } from 'class-validator';

export class UpdateInvoiceUploadDto {
  @IsString()
  @IsUUID()
  customerId: string;
}
