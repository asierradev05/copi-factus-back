import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ServicesService } from './services.service';
import {
  CreateServiceDto,
  FilterServiceDto,
  InvoiceFromServiceDto,
  UpdateServiceDto,
  UpdateServiceStatusDto,
} from './dto/service.dto';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('services')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('types')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findServiceTypes() {
    return this.servicesService.findServiceTypes();
  }

  @Post('types')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  createServiceType(
    @Body() dto: CreateServiceTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.servicesService.createServiceType(dto, user.id);
  }

  @Get('pending-invoice')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findPendingInvoice() {
    return this.servicesService.findPendingInvoice();
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterServiceDto) {
    return this.servicesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: CreateServiceDto, @CurrentUser() user: AuthUser) {
    return this.servicesService.create(dto, user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateServiceStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.servicesService.updateStatus(id, dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.servicesService.update(id, dto, user.id);
  }

  @Post(':id/invoice')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  invoiceFromService(
    @Param('id') id: string,
    @Body() dto: InvoiceFromServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.servicesService.invoiceFromService(id, dto, user.id);
  }
}
