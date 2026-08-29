import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/utils/document-sequence.util';
import { toDecimal } from '../common/utils/money.util';
import {
  CreateQuoteDto,
  FilterQuoteDto,
  UpdateQuoteStatusDto,
} from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: FilterQuoteDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.QuoteWhereInput = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.issueDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: { customer: true },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.quote.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!quote) {
      throw new NotFoundException('La cotización no fue encontrada.');
    }
    return quote;
  }

  async create(dto: CreateQuoteDto, userId: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'La cotización debe tener al menos un ítem.',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new BadRequestException('El cliente seleccionado no existe.');
    }

    const { items, subtotal, discountTotal, taxTotal, total } =
      this.computeItems(dto.items);

    const quoteNumber = await this.prisma.$transaction((tx) =>
      nextDocumentNumber(tx, 'quote', 'COT'),
    );

    const quote = await this.prisma.quote.create({
      data: {
        quoteNumber,
        customerId: dto.customerId,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        items,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        notes: dto.notes?.trim(),
        createdById: userId,
      },
      include: { customer: true },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'Quote',
        entityId: quote.id,
        newValue: { quoteNumber, total: total.toNumber() },
      })
      .catch(() => {});

    return quote;
  }

  async updateStatus(id: string, dto: UpdateQuoteStatusDto, userId: string) {
    const current = await this.findOne(id);

    if (current.status === QuoteStatus.FACTURADA) {
      throw new BadRequestException(
        'No se puede cambiar el estado de una cotización ya facturada.',
      );
    }

    const quote = await this.prisma.quote.update({
      where: { id },
      data: { status: dto.status },
      include: { customer: true },
    });

    await this.audit
      .log({
        userId,
        action:
          dto.status === QuoteStatus.APROBADA ||
          dto.status === QuoteStatus.RECHAZADA
            ? AuditAction.UPDATE
            : AuditAction.CREATE,
        entityType: 'Quote',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: dto.status },
      })
      .catch(() => {});

    return quote;
  }

  private computeItems(items: CreateQuoteDto['items']) {
    const computed = items.map((item) => {
      const quantity = toDecimal(item.quantity);
      const unitPrice = toDecimal(item.unitPrice);
      const discount = toDecimal(item.discount ?? 0);
      const taxRate = toDecimal(item.taxRate ?? 0);

      const lineExtension = quantity.mul(unitPrice);
      const subtotal = lineExtension.sub(discount);
      const taxAmount = subtotal.mul(taxRate).div(100);
      const total = subtotal.add(taxAmount);

      return {
        productCode: item.productCode?.trim() || null,
        description: item.description.trim(),
        quantity: quantity.toNumber(),
        unitPrice: unitPrice.toNumber(),
        discount: discount.toNumber(),
        taxRate: taxRate.toNumber(),
        subtotal: subtotal.toNumber(),
        taxAmount: taxAmount.toNumber(),
        total: total.toNumber(),
      };
    });

    return {
      items: computed as Prisma.InputJsonValue,
      subtotal: toDecimal(computed.reduce((s, i) => s + i.subtotal, 0)),
      discountTotal: toDecimal(computed.reduce((s, i) => s + i.discount, 0)),
      taxTotal: toDecimal(computed.reduce((s, i) => s + i.taxAmount, 0)),
      total: toDecimal(computed.reduce((s, i) => s + i.total, 0)),
    };
  }
}
