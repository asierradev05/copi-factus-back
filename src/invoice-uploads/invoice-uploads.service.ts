import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SupabaseService } from '../common/supabase/supabase.service';

export interface ExtractedInvoiceData {
  nit?: string;
  date?: Date;
  amount?: number;
  concept?: string;
}

const BUCKET = 'invoice-pdfs';

@Injectable()
export class InvoiceUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly supabase: SupabaseService,
  ) {}

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.invoiceUpload.findMany({
        include: {
          uploadedBy: { select: { id: true, email: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoiceUpload.count(),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  findOne(id: string) {
    return this.prisma.invoiceUpload.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  async create(
    dto: {
      fileName: string;
      fileSize: number;
      storagePath: string;
    },
    userId: string,
  ): Promise<{ upload: unknown; extracted: ExtractedInvoiceData }> {
    const safeName = dto.fileName.replace(/[^\w.\-() ]/g, '_');
    const [bucket, ...rest] = dto.storagePath.split('/');
    const objectPath = rest.join('/');
    if (!bucket || !objectPath) {
      throw new BadRequestException('storagePath inválido.');
    }

    const buffer = await this.supabase.downloadAsBuffer(bucket, objectPath);
    const extracted = await this.extractFromPdf(buffer);

    const upload = await this.prisma.invoiceUpload.create({
      data: {
        fileName: safeName,
        filePath: dto.storagePath,
        fileSize: dto.fileSize,
        extractedNit: extracted.nit,
        extractedDate: extracted.date,
        extractedAmount:
          extracted.amount !== undefined
            ? new Prisma.Decimal(extracted.amount)
            : null,
        extractedConcept: extracted.concept,
        uploadedById: userId,
      },
      include: {
        uploadedBy: { select: { id: true, email: true, fullName: true } },
      },
    });

    await this.audit.log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'InvoiceUpload',
      entityId: upload.id,
      newValue: {
        fileName: upload.fileName,
        extracted: {
          nit: extracted.nit,
          amount: extracted.amount,
        },
      },
    });

    return { upload, extracted };
  }

  async presignUpload(): Promise<{ uploadUrl: string; storagePath: string }> {
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const storagePath = `${BUCKET}/${fileId}.pdf`;
    const uploadUrl = await this.supabase.presignUploadUrl(BUCKET, storagePath);
    return { uploadUrl, storagePath };
  }

  async getSignedReadUrl(upload: { filePath: string }): Promise<string> {
    const [bucket, ...rest] = upload.filePath.split('/');
    const objectPath = rest.join('/');
    if (!bucket || !objectPath) {
      throw new NotFoundException(
        'El archivo de la factura no fue encontrado.',
      );
    }
    return this.supabase.signedReadUrl(bucket, objectPath);
  }

  private async extractFromPdf(buffer: Buffer): Promise<ExtractedInvoiceData> {
    const text = await this.extractText(buffer);
    return {
      nit: this.matchNit(text),
      date: this.matchDate(text),
      amount: this.matchAmount(text),
      concept: this.matchConcept(text),
    };
  }

  private async extractText(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return result.text ?? '';
      } finally {
        await parser.destroy();
      }
    } catch {
      return '';
    }
  }

  private matchNit(text: string): string | undefined {
    const patterns = [
      /NIT(?:[:\s.]+)?([\d]{8,11}(?:-[05])?)/i,
      /N\.?I\.?T\.?[:\s]*([\d]{8,11}(?:-[05])?)/i,
      /(?:C\.?C\.?|NIT)[:\s]*([\d]{8,11}(?:-[05])?)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return undefined;
  }

  private matchDate(text: string): Date | undefined {
    const patterns = [
      /fecha(?: de\s+)?(?:factura|emisi[oó]n)?[:\s.]*([\d]{1,2})[-\/]([\d]{1,2})[-\/]([\d]{4})/i,
      /([\d]{4})-([\d]{1,2})-([\d]{1,2})/,
      /([\d]{4})-([\d]{1,2})-([\d]{1,2})[T\s][\d:]+/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[3]) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        const date = new Date(year, month - 1, day);
        if (!Number.isNaN(date.getTime())) return date;
      }
    }
    return undefined;
  }

  private matchAmount(text: string): number | undefined {
    const patterns = [
      /total a pagar[:\s.]*[$]?\s*([\d.,]+)/i,
      /total(?: general)?[:\s.]*[$]?\s*([\d.,]+)/i,
      /valor a pagar[:\s.]*[$]?\s*([\d.,]+)/i,
      /(?:total)(?:\s+de la factura)?[:\s.,]*[$]?\s*([\d.,]+)\s*$/im,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1];
      if (!value) continue;
      const normalized = this.toNumber(value);
      if (normalized !== undefined) return normalized;
    }
    return undefined;
  }

  private matchConcept(text: string): string | undefined {
    const pattern = /(?:concepto|detalle|descripci[oó]n)[:\s.]*(.{3,120})/i;
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, ' ').trim();
    }
    return undefined;
  }

  private toNumber(value: string): number | undefined {
    const cleaned = value.replace(/\s/g, '');
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');
    if (hasComma && hasDot) {
      if (cleaned.indexOf(',') > cleaned.indexOf('.')) {
        return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
      }
      return parseFloat(cleaned.replace(/,/g, ''));
    }
    const normalized = cleaned.replace(',', '.');
    const number = parseFloat(normalized);
    return Number.isFinite(number) ? number : undefined;
  }
}
