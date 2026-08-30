import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InvoiceUploadsController } from './invoice-uploads.controller';
import { InvoiceUploadsService } from './invoice-uploads.service';

@Module({
  imports: [AuditModule],
  controllers: [InvoiceUploadsController],
  providers: [InvoiceUploadsService],
  exports: [InvoiceUploadsService],
})
export class InvoiceUploadsModule {}
