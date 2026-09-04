import { Module } from '@nestjs/common';
import { DocumentAttachmentsController } from './document-attachments.controller';
import { DocumentAttachmentsService } from './document-attachments.service';
import { PrismaModule } from '../database/prisma.module';
import { SupabaseModule } from '../common/supabase/supabase.module';

@Module({
  imports: [PrismaModule, SupabaseModule],
  controllers: [DocumentAttachmentsController],
  providers: [DocumentAttachmentsService],
  exports: [DocumentAttachmentsService],
})
export class DocumentAttachmentsModule {}
