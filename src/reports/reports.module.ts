import { Module } from '@nestjs/common';
import { AccountsReceivableModule } from '../accounts-receivable/accounts-receivable.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AccountsReceivableModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
