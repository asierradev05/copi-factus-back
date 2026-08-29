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
import { RecurringServicesService } from './recurring-services.service';
import {
  CreateRecurringServiceDto,
  CreateServiceCategoryDto,
  CreateServiceSubcategoryDto,
  FilterRecurringServiceDto,
  UpdateRecurringServiceDto,
  UpdateRecurringServiceStatusDto,
} from './dto/recurring-service.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('recurring-services')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecurringServicesController {
  constructor(private readonly recurringServices: RecurringServicesService) {}

  @Get('categories')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  listCategories() {
    return this.recurringServices.listCategories();
  }

  @Post('categories')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  createCategory(
    @Body() dto: CreateServiceCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recurringServices.createCategory(dto, user.id);
  }

  @Get('subcategories')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  listSubcategories(@Query('categoryId') categoryId?: string) {
    return this.recurringServices.listSubcategories(categoryId ?? undefined);
  }

  @Post('subcategories')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  createSubcategory(
    @Body() dto: CreateServiceSubcategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recurringServices.createSubcategory(dto, user.id);
  }

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  summary() {
    return this.recurringServices.summary();
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterRecurringServiceDto) {
    return this.recurringServices.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.recurringServices.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(
    @Body() dto: CreateRecurringServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recurringServices.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecurringServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recurringServices.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRecurringServiceStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recurringServices.updateStatus(id, dto, user.id);
  }
}