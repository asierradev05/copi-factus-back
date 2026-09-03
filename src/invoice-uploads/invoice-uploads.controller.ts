import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { InvoiceUploadsService } from './invoice-uploads.service';
import { RegisterInvoiceUploadDto } from './dto/register-invoice-upload.dto';
import { UpdateInvoiceUploadDto } from './dto/update-invoice-upload.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('invoice-uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoiceUploadsController {
  constructor(private readonly invoiceUploads: InvoiceUploadsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(
    @Query('page', ParseIntPipe) page = 1,
    @Query('limit', ParseIntPipe) limit = 20,
  ) {
    return this.invoiceUploads.findAll(page, limit);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.invoiceUploads.findOne(id);
  }

  @Get(':id/file')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  async getFileLink(@Param('id') id: string) {
    const upload = await this.invoiceUploads.findOne(id);
    if (!upload) {
      throw new NotFoundException(
        'El archivo de la factura no fue encontrado.',
      );
    }
    const url = await this.invoiceUploads.getSignedReadUrl(upload);
    return { url };
  }

  @Post('presign')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  presignUpload() {
    return this.invoiceUploads.presignUpload();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: RegisterInvoiceUploadDto, @CurrentUser() user: AuthUser) {
    return this.invoiceUploads.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoiceUploads.update(id, dto.customerId, user.id);
  }
}
