import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-user.type';
import { FactusSyncService } from './factus-sync.service';

@Controller('factus')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FactusController {
  constructor(private readonly sync: FactusSyncService) {}

  @Get('status')
  @Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
  status() {
    return this.sync.getStatus();
  }

  @Post('companies/sync')
  @Roles(UserRole.ADMIN)
  syncCompany(@CurrentUser() user: AuthUser) {
    return this.sync.syncCompany(user.id);
  }

  @Post('resolutions/:id/sync-range')
  @Roles(UserRole.ADMIN)
  syncRange(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sync.syncResolutionRange(id, user.id);
  }
}