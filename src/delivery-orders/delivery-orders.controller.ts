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
import { DeliveryOrdersService } from './delivery-orders.service';
import {
  CreateDeliveryOrderDto,
  FilterDeliveryOrderDto,
  UpdateDeliveryOrderStatusDto,
} from './dto/delivery-order.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('delivery-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryOrdersController {
  constructor(private readonly deliveryOrders: DeliveryOrdersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterDeliveryOrderDto) {
    return this.deliveryOrders.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.deliveryOrders.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: CreateDeliveryOrderDto, @CurrentUser() user: AuthUser) {
    return this.deliveryOrders.create(dto, user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.deliveryOrders.updateStatus(id, dto, user.id);
  }
}
