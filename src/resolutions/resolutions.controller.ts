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
import { ResolutionsService } from './resolutions.service';
import {
  CreateResolutionDto,
  FilterResolutionDto,
  UpdateResolutionDto,
} from './dto/resolution.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';

@Controller('resolutions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResolutionsController {
  constructor(private readonly resolutions: ResolutionsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findAll(@Query() query: FilterResolutionDto) {
    return this.resolutions.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  findOne(@Param('id') id: string) {
    return this.resolutions.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  create(@Body() dto: CreateResolutionDto, @CurrentUser() user: AuthUser) {
    return this.resolutions.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateResolutionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.resolutions.update(id, dto, user.id);
  }

  @Post(':id/next')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR)
  nextConsecutive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.resolutions.nextConsecutive(id, user.id);
  }
}
