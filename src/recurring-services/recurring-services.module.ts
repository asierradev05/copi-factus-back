import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RecurringServicesController } from './recurring-services.controller';
import { RecurringServicesService } from './recurring-services.service';

@Module({
  imports: [AuditModule],
  controllers: [RecurringServicesController],
  providers: [RecurringServicesService],
  exports: [RecurringServicesService],
})
export class RecurringServicesModule {}
