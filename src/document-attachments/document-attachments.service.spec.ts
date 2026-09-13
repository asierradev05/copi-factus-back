import { BadRequestException } from '@nestjs/common';
import { DocumentAttachmentsService } from './document-attachments.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { PrismaService } from '../database/prisma.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';

describe('DocumentAttachmentsService', () => {
  let service: DocumentAttachmentsService;
  const presignUploadUrl = jest.fn();
  const prismaCreate = jest.fn();

  beforeEach(() => {
    presignUploadUrl.mockReset();
    presignUploadUrl.mockImplementation((_bucket: string, path: string) =>
      Promise.resolve(`https://signed/${path}`),
    );
    prismaCreate.mockReset();
    prismaCreate.mockResolvedValue({ id: 'attachment-1' });

    const supabase = {
      ensureBucket: jest.fn().mockResolvedValue(undefined),
      presignUploadUrl,
    } as unknown as SupabaseService;

    const prisma = {
      documentAttachment: {
        create: prismaCreate,
      },
    } as unknown as PrismaService;

    service = new DocumentAttachmentsService(prisma, supabase);
  });

  describe('presignUpload', () => {
    it('rechaza entityType que no está en el enum (evita path traversal via /)', async () => {
      await expect(
        service.presignUpload('factura.pdf', '../../etc', 'uuid'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(presignUploadUrl).not.toHaveBeenCalled();
    });

    it('rechaza entityId con separadores de ruta', async () => {
      await expect(
        service.presignUpload('factura.pdf', 'invoice', '../../etc/passwd'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(presignUploadUrl).not.toHaveBeenCalled();
    });

    it('rechaza entityId vacío o con caracteres no alfanuméricos-guión', async () => {
      await expect(
        service.presignUpload('factura.pdf', 'invoice', 'abc..def'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(presignUploadUrl).not.toHaveBeenCalled();
    });

    it('sanitiza fileName eliminando separadores de ruta', async () => {
      const result = await service.presignUpload(
        '../../etc/passwd.pdf',
        'invoice',
        '11111111-2222-3333-4444-555555555555',
      );
      const finalName = result.path.split('/').pop() ?? '';
      expect(result.path).not.toContain('..');
      expect(finalName).not.toContain('/');
      expect(finalName).toMatch(/^[\d]+-[A-Za-z0-9._()-]+$/);
    });

    it('construye la ruta bajo el prefijo attachments/<tipo>/<id>', async () => {
      const result = await service.presignUpload(
        'factura 2026.pdf',
        'invoice',
        '11111111-2222-3333-4444-555555555555',
      );
      expect(result.path).toMatch(
        /^attachments\/invoice\/11111111-2222-3333-4444-555555555555\/[\d]+-factura 2026.pdf$/,
      );
    });
  });

  describe('create', () => {
    const base: CreateAttachmentDto = {
      entityType: 'invoice',
      entityId: '11111111-2222-3333-4444-555555555555',
      fileName: 'factura.pdf',
      storagePath: 'document-attachments/invoice/11111111-2222-3333-4444-555555555555/123-factura.pdf',
    };

    it('rechaza storagePath con bucket distinto al de adjuntos', async () => {
      await expect(
        service.create({ ...base, storagePath: 'invoice-pdfs/x.pdf' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaCreate).not.toHaveBeenCalled();
    });

    it('rechaza storagePath con traversal (..)', async () => {
      await expect(
        service.create(
          {
            ...base,
            storagePath: 'document-attachments/../../etc/passwd.pdf',
          },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaCreate).not.toHaveBeenCalled();
    });

    it('persiste el adjunto cuando el storagePath es válido', async () => {
      const result = await service.create(base, 'user-1');
      expect(result).toEqual({ id: 'attachment-1' });
      expect(prismaCreate).toHaveBeenCalledWith({
        data: {
          entityType: 'invoice',
          entityId: '11111111-2222-3333-4444-555555555555',
          fileName: 'factura.pdf',
          filePath: base.storagePath,
          fileSize: undefined,
          mimeType: undefined,
          notes: undefined,
          uploadedById: 'user-1',
        },
      });
    });

    it('rechaza un archivo mayor al límite de tamaño', async () => {
      await expect(
        service.create({ ...base, fileSize: 11 * 1024 * 1024 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaCreate).not.toHaveBeenCalled();
    });

    it('rechaza un archivo con extensión no permitida', async () => {
      await expect(
        service.create({ ...base, fileName: 'app.exe' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaCreate).not.toHaveBeenCalled();
    });

    it('rechaza un archivo con mimeType peligroso', async () => {
      await expect(
        service.create({ ...base, mimeType: 'application/x-msdownload' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaCreate).not.toHaveBeenCalled();
    });
  });

  describe('presignUpload (límites de archivo)', () => {
    it('rechaza presign de una extensión no permitida', async () => {
      await expect(
        service.presignUpload(
          'backdoor.exe',
          'invoice',
          '11111111-2222-3333-4444-555555555555',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(presignUploadUrl).not.toHaveBeenCalled();
    });

    it('permite presign de imágenes y pdf', async () => {
      for (const name of ['foto.png', 'logo.jpg', 'doc.pdf']) {
        const result = await service.presignUpload(
          name,
          'invoice',
          '11111111-2222-3333-4444-555555555555',
        );
        expect(result.path.split('.').pop()).toBe(name.split('.').pop());
      }
    });
  });
});