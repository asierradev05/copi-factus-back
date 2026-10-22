import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import {
  AttachmentEntityType,
  CreateAttachmentDto,
} from './dto/create-attachment.dto';

@Injectable()
export class DocumentAttachmentsService {
  private readonly BUCKET = 'document-attachments';
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;
  private readonly ALLOWED_EXTENSIONS = [
    'pdf',
    'doc',
    'docx',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
  ];
  private readonly ALLOWED_MIME_PREFIXES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/',
  ];

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
    const attachment = await this.prisma.documentAttachment.findUnique({
      where: { id },
    });
    if (!attachment) throw new NotFoundException('Adjunto no encontrado.');
    return attachment;
  }

  async create(dto: CreateAttachmentDto, userId: string) {
    const objectPath = this.normalizeStoragePath(dto);
    this.assertFileAllowed(dto.fileName, dto.fileSize, dto.mimeType);

    return this.prisma.documentAttachment.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId.trim(),
        fileName: dto.fileName,
        filePath: objectPath,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        notes: dto.notes,
        uploadedById: userId,
      },
    });
  }

  async presignUpload(fileName: string, entityType: string, entityId: string) {
    const type = Object.values(AttachmentEntityType).includes(
      entityType as AttachmentEntityType,
    )
      ? entityType
      : null;
    if (!type) {
      throw new BadRequestException('Tipo de entidad no válido.');
    }

    const cleanId = (entityId ?? '').trim();
    if (!/^[A-Za-z0-9-]+$/.test(cleanId)) {
      throw new BadRequestException('Id de entidad no válido.');
    }

    const cleanName = this.sanitizeFileName(fileName);
    if (!cleanName) {
      throw new BadRequestException('Nombre de archivo no válido.');
    }
    this.assertFileAllowed(cleanName);

    await this.supabase.ensureBucket(this.BUCKET);
    const path = `attachments/${type}/${cleanId}/${Date.now()}-${cleanName}`;
    const url = await this.supabase.presignUploadUrl(this.BUCKET, path);
    return { url, path };
  }

  async getSignedReadUrl(id: string) {
    const attachment = await this.findOne(id);
    return this.supabase.signedReadUrl(
      this.BUCKET,
      this.toObjectPath(attachment.filePath),
    );
  }

  async remove(id: string) {
    const attachment = await this.findOne(id);
    await this.supabase
      .getClient()
      .storage.from(this.BUCKET)
      .remove([this.toObjectPath(attachment.filePath)]);
    return this.prisma.documentAttachment.delete({ where: { id } });
  }

  private normalizeStoragePath(dto: CreateAttachmentDto): string {
    const raw = (dto.storagePath ?? '').trim();
    const bucketPrefix = `${this.BUCKET}/`;
    const objectPath = raw.startsWith(bucketPrefix)
      ? raw.slice(bucketPrefix.length)
      : raw;
    const entityId = (dto.entityId ?? '').trim();
    const expectedPrefix = `attachments/${dto.entityType}/${entityId}/`;

    if (
      !/^[A-Za-z0-9-]+$/.test(entityId) ||
      !objectPath.startsWith(expectedPrefix) ||
      objectPath.includes('..') ||
      objectPath.endsWith('/')
    ) {
      throw new BadRequestException('storagePath inválido.');
    }

    return objectPath;
  }

  private toObjectPath(filePath: string): string {
    const bucketPrefix = `${this.BUCKET}/`;
    return filePath.startsWith(bucketPrefix)
      ? filePath.slice(bucketPrefix.length)
      : filePath;
  }

  private sanitizeFileName(fileName: string): string {
    return (fileName ?? '')
      .replace(/[^\w.\-() ]/g, '_')
      .replace(/\.{2,}/g, '_')
      .trim()
      .slice(0, 255);
  }

  private assertFileAllowed(
    fileName: string,
    fileSize?: number,
    mimeType?: string | null,
  ): void {
    if (fileSize != null && fileSize > this.MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo no puede superar 10MB.');
    }
    const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    if (!ext || !this.ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException('Formato de archivo no permitido.');
    }
    if (mimeType) {
      const allowed = this.ALLOWED_MIME_PREFIXES.some((prefix) =>
        mimeType.startsWith(prefix),
      );
      if (!allowed) {
        throw new BadRequestException('Tipo de archivo no permitido.');
      }
    }
  }
}
