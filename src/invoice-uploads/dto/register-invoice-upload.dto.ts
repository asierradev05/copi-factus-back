import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class RegisterInvoiceUploadDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  fileSize: number;

  @IsString()
  @IsNotEmpty()
  storagePath: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  customerId?: string;
}
