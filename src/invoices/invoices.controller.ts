import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import {
  CreateInvoiceDto,
  FilterInvoiceDto,
  SendInvoiceEmailDto,
} from './dto/invoice.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterInvoiceDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.invoicesService.createDraft(dto, user.id);
  }

  @Patch(':id/emit')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  emit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.emit(id, user.id);
  }

  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  async getPdf(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.invoicesService.getPdfBuffer(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="factura.pdf"',
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  @Post(':id/send-email')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  sendEmail(
    @Param('id') id: string,
    @Body() dto: SendInvoiceEmailDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoicesService.sendInvoiceEmail(id, dto, user.id);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.cancel(id, user.id);
  }
}
