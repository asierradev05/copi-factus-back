import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateReceivedDocumentDto,
  FilterReceivedDocumentDto,
  UpdateReceivedDocumentDto,
} from './dto/received-document.dto';

@Injectable()
export class ReceivedDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: FilterReceivedDocumentDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ReceivedDocumentWhereInput = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      where.OR = [
        { supplierName: { contains: query.search, mode: 'insensitive' } },
        { supplierNit: { contains: query.search, mode: 'insensitive' } },
        { documentNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.from || query.to) {
      where.issueDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.receivedDocument.findMany({
        where,
        include: { customer: true, createdBy: true },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.receivedDocument.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const document = await this.prisma.receivedDocument.findUnique({
      where: { id },
      include: { customer: true, createdBy: true },
    });
    if (!document) {
      throw new NotFoundException('El documento recibido no fue encontrado.');
    }
    return document;
  }

  async create(dto: CreateReceivedDocumentDto, userId: string) {
    const document = await this.prisma.receivedDocument.create({
      data: {
        customerId: dto.customerId ?? null,
        supplierName: dto.supplierName.trim(),
        supplierNit: dto.supplierNit?.trim() ?? null,
        documentNumber: dto.documentNumber.trim(),
        issueDate: new Date(dto.issueDate),
        amount: dto.amount,
        taxAmount: dto.taxAmount ?? 0,
        concept: dto.concept?.trim() ?? null,
        filePath: dto.filePath?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
        createdById: userId,
      },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'ReceivedDocument',
        entityId: document.id,
        newValue: {
          supplierName: document.supplierName,
          documentNumber: document.documentNumber,
        },
      })
      .catch(() => {});

    return document;
  }

  async update(id: string, dto: UpdateReceivedDocumentDto, userId: string) {
    await this.findOne(id);

    const document = await this.prisma.receivedDocument.update({
      where: { id },
      data: {
        ...(dto.customerId !== undefined
          ? { customerId: dto.customerId ?? null }
          : {}),
        ...(dto.supplierName !== undefined
          ? { supplierName: dto.supplierName.trim() }
          : {}),
        ...(dto.supplierNit !== undefined
          ? { supplierNit: dto.supplierNit?.trim() ?? null }
          : {}),
        ...(dto.documentNumber !== undefined
          ? { documentNumber: dto.documentNumber.trim() }
          : {}),
        ...(dto.issueDate !== undefined
          ? { issueDate: new Date(dto.issueDate) }
          : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.taxAmount !== undefined ? { taxAmount: dto.taxAmount } : {}),
        ...(dto.concept !== undefined
          ? { concept: dto.concept?.trim() ?? null }
          : {}),
        ...(dto.filePath !== undefined
          ? { filePath: dto.filePath?.trim() ?? null }
          : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() ?? null }
          : {}),
      },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.UPDATE,
        entityType: 'ReceivedDocument',
        entityId: id,
        newValue: { documentNumber: document.documentNumber },
      })
      .catch(() => {});

    return document;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);

    const document = await this.prisma.receivedDocument.delete({
      where: { id },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.DELETE,
        entityType: 'ReceivedDocument',
        entityId: id,
        oldValue: existing,
        newValue: document,
      })
      .catch(() => {});

    return document;
  }
}
