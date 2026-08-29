import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { InvoiceUploadsService } from './invoice-uploads.service';
import type { UploadedFileLike } from './invoice-uploads.service';
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
  async getFile(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const upload = await this.invoiceUploads.findOne(id);
    if (!upload) {
      return null;
    }
    const buffer = this.invoiceUploads.getFileBuffer(upload);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${upload.fileName}"`,
    });
    return new StreamableFile(buffer);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoiceUploads.create(file, user.id);
  }
}