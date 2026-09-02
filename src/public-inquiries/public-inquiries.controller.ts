import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { PublicInquiriesService } from './public-inquiries.service';
import {
  CreatePublicInquiryDto,
  FilterPublicInquiryDto,
  UpdatePublicInquiryStatusDto,
} from './dto/public-inquiry.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('public-inquiries')
export class PublicInquiriesController {
  constructor(private readonly publicInquiries: PublicInquiriesService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  create(@Body() dto: CreatePublicInquiryDto) {
    return this.publicInquiries.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterPublicInquiryDto) {
    return this.publicInquiries.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.publicInquiries.findOne(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePublicInquiryStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.publicInquiries.updateStatus(id, dto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.publicInquiries.remove(id);
  }
}
