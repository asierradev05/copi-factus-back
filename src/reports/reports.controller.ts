import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import {
  SalesReportQueryDto,
  ServicesReportQueryDto,
} from './dto/report-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FACTURADOR, UserRole.CONSULTA)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  getSalesReport(@Query() query: SalesReportQueryDto) {
    return this.reportsService.getSalesReport(query);
  }

  @Get('receivables')
  getReceivablesReport() {
    return this.reportsService.getReceivablesReport();
  }

  @Get('services')
  getServicesReport(@Query() query: ServicesReportQueryDto) {
    return this.reportsService.getServicesReport(query);
  }
}
