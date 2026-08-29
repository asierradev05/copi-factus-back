import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateServiceTypeDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
