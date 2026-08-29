import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccountsReceivableService } from './accounts-receivable.service';
import { FilterReceivableDto } from './dto/filter-receivable.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('accounts-receivable')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
export class AccountsReceivableController {
  constructor(
    private readonly accountsReceivableService: AccountsReceivableService,
  ) {}

  @Get('summary')
  getSummary() {
    return this.accountsReceivableService.getSummary();
  }

  @Get('customer/:id/statement')
  getCustomerStatement(@Param('id') id: string) {
    return this.accountsReceivableService.getCustomerStatement(id);
  }

  @Get()
  list(@Query() query: FilterReceivableDto) {
    return this.accountsReceivableService.list(query);
  }
}
