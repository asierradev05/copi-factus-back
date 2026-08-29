import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReceivedDocumentsController } from './received-documents.controller';
import { ReceivedDocumentsService } from './received-documents.service';

@Module({
  imports: [AuditModule],
  controllers: [ReceivedDocumentsController],
  providers: [ReceivedDocumentsService],
  exports: [ReceivedDocumentsService],
})
export class ReceivedDocumentsModule {}
