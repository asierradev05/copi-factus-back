import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';

@Injectable()
export class DocumentAttachmentsService {
  private readonly BUCKET = 'document-attachments';

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  async findByEntity(entityType?: string, entityId?: string) {
    return this.prisma.documentAttachment.findMany({
      where: {
        ...(entityType && { entityType }),
        ...(entityId && { entityId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const attachment = await this.prisma.documentAttachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');
    return attachment;
  }

  async create(dto: CreateAttachmentDto, userId: string) {
    return this.prisma.documentAttachment.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        fileName: dto.fileName,
        filePath: dto.storagePath,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        notes: dto.notes,
        uploadedById: userId,
      },
    });
  }

  async presignUpload(fileName: string, entityType: string, entityId: string) {
    await this.supabase.ensureBucket(this.BUCKET);
    const path = `attachments/${entityType}/${entityId}/${Date.now()}-${fileName}`;
    const url = await this.supabase.presignUploadUrl(this.BUCKET, path);
    return { url, path };
  }

  async getSignedReadUrl(id: string) {
    const attachment = await this.findOne(id);
    return this.supabase.signedReadUrl(this.BUCKET, attachment.filePath);
  }

  async remove(id: string) {
    const attachment = await this.findOne(id);
    await this.supabase.getClient().storage.from(this.BUCKET).remove([attachment.filePath]);
    return this.prisma.documentAttachment.delete({ where: { id } });
  }
}
