import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  PurchaseOrderStatus,
  QuoteStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/utils/document-sequence.util';
import { toDecimal } from '../common/utils/money.util';
import { useInMemoryFallback } from '../common/utils/fallback.util';
import { globalStore } from '../database/in-memory-store';
import { EmailService } from '../common/email/email.service';
import { renderBrandedEmail } from '../common/email/branded-email.template';
import {
  generateQuotePdf,
  type QuotePdfModel,
} from '../common/pdf/quote-pdf.util';
import type { CompanyPdfModel } from '../common/pdf/invoice-pdf.util';
import { getBrandLogoBase64, BRAND } from '../common/pdf/brand-assets.util';
import {
  CreateQuoteDto,
  FilterQuoteDto,
  SendQuoteEmailDto,
  UpdateQuoteStatusDto,
} from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
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
        include: { customer: true, purchaseOrders: true },
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
      include: { customer: true, purchaseOrders: true },
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

    if (dto.items.some((i) => Number(i.unitPrice) <= 0)) {
      throw new BadRequestException(
        'El valor unitario de cada ítem debe ser mayor a 0.',
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

  async convertToPurchaseOrder(id: string, userId: string) {
    const quote = await this.findOne(id);

    if (quote.status === QuoteStatus.RECHAZADA) {
      throw new BadRequestException(
        'No se puede crear una orden de compra a partir de una cotización rechazada.',
      );
    }
    if (quote.status === QuoteStatus.FACTURADA) {
      throw new BadRequestException('Esta cotización ya fue facturada.');
    }
    if (quote.status !== QuoteStatus.APROBADA) {
      throw new BadRequestException(
        'La cotización debe estar aprobada antes de crear la orden de compra.',
      );
    }

    const items = quote.items as Prisma.InputJsonValue as Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      discount?: number;
      taxRate?: number;
    }>;

    const poNumber = await this.prisma.$transaction((tx) =>
      nextDocumentNumber(tx, 'purchase-order', 'OC'),
    );

    const po = await this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        customerId: quote.customerId,
        issueDate: new Date(),
        quoteId: quote.id,
        items: items,
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        notes: quote.notes,
        status: PurchaseOrderStatus.SOLICITADA,
        createdById: userId,
      },
      include: { customer: true, invoice: true, quote: true },
    });

    await this.prisma.quote.update({
      where: { id: quote.id },
      data: { status: QuoteStatus.APROBADA },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'PurchaseOrder',
        entityId: po.id,
        newValue: { poNumber, source: 'Quote', quoteNumber: quote.quoteNumber },
      })
      .catch(() => {});

    return po;
  }

  async sendEmail(id: string, dto: SendQuoteEmailDto, userId: string) {
    const quote = await this.findOne(id);
    const to = (dto.to ?? '').trim() || quote.customer?.email || null;

    if (!to) {
      throw new BadRequestException(
        'Debe indicar un correo de destino o registrar el correo del cliente.',
      );
    }

    const company = await this.getCompanyPdfModel();
    const logoBase64 = company.logoBase64 ?? (await getBrandLogoBase64());
    company.logoBase64 = logoBase64;
    const pdfBuffer = await generateQuotePdf(
      this.toPdfModel(quote),
      company,
      quote.status,
    );

    const formatMoney = (v: unknown) =>
      Number(v ?? 0).toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const formatDate = (v?: Date | string | null) =>
      v ? new Date(v).toLocaleDateString('es-CO') : '-';

    const QUOTE_STATUS_LABELS: Record<string, string> = {
      PENDIENTE: 'Pendiente',
      APROBADA: 'Aprobada',
      RECHAZADA: 'Rechazada',
      FACTURADA: 'Facturada',
    };

    const html = renderBrandedEmail({
      companyName: company.name,
      title: `Cotización ${quote.quoteNumber}`,
      subtitle: `Hola${quote.customer ? ` ${quote.customer.name}` : ''}, adjuntamos su cotización.`,
      rows: [
        { label: 'Número', value: quote.quoteNumber },
        { label: 'Cliente', value: quote.customer?.name ?? '-' },
        { label: 'Fecha', value: formatDate(quote.issueDate) },
        ...(quote.validUntil
          ? [{ label: 'Vigencia', value: formatDate(quote.validUntil) }]
          : []),
      ],
      totalLabel: 'Total',
      totalValue: formatMoney(quote.total),
      statusLabel: QUOTE_STATUS_LABELS[quote.status] ?? quote.status,
      logoBase64,
      contact: {
        address: BRAND.address,
        phone: BRAND.phone,
        email: BRAND.email,
        website: BRAND.website,
      },
    });

    const result = await this.email.sendMail({
      to,
      subject: `Cotización ${quote.quoteNumber} - ${company.name}`,
      html,
      attachments: [
        { filename: `${quote.quoteNumber}.pdf`, content: pdfBuffer },
      ],
    });

    try {
      await this.prisma.quote.update({
        where: { id },
        data: { emailSentAt: new Date() },
      });
    } catch {
      quote.emailSentAt = new Date();
    }

    await this.audit
      .log({
        userId,
        action: AuditAction.UPDATE,
        entityType: 'Quote',
        entityId: id,
        newValue: { emailSentAt: true, to },
      })
      .catch(() => {});

    return {
      success: true,
      messageId: result.messageId,
      to,
      simulated: result.simulated,
    };
  }

  private async getCompanyPdfModel(): Promise<CompanyPdfModel> {
    try {
      const settings = await this.prisma.companySettings.findUnique({
        where: { id: 'default' },
      });

      if (settings) {
        return {
          name: settings.name,
          legalName: settings.legalName,
          taxId: settings.taxId,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
          city: settings.city,
          logoUrl: settings.logoUrl,
        };
      }
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
    }

    const settings = globalStore.companySettings;
    return {
      name: settings.name ?? 'CopiGráfica Sierra',
      legalName: settings.legalName ?? settings.name ?? 'CopiGráfica Sierra',
      taxId: settings.taxId ?? null,
      address: settings.address ?? null,
      phone: settings.phone ?? null,
      email: settings.email ?? null,
      city: settings.city ?? null,
      logoUrl: settings.logoUrl ?? null,
    };
  }

  private toPdfModel(quote: any): QuotePdfModel {
    const items = (quote.items ?? []) as Array<{
      description?: string;
      quantity?: number;
      unitPrice?: number;
      taxRate?: number;
    }>;

    return {
      quoteNumber: quote.quoteNumber,
      issuedAt: quote.issueDate ?? null,
      validUntil: quote.validUntil ?? null,
      customerName: quote.customer?.name ?? null,
      customerDocument: quote.customer?.documentNumber ?? null,
      address: quote.customer?.address ?? null,
      lines: items.map((it) => ({
        description: it.description ?? '-',
        quantity: Number(it.quantity ?? 0),
        unitPrice: Number(it.unitPrice ?? 0),
        taxRate: it.taxRate ?? 0,
      })),
      subtotal: Number(quote.subtotal ?? 0),
      taxTotal: Number(quote.taxTotal ?? 0),
      total: Number(quote.total ?? 0),
      notes: quote.notes ?? null,
    };
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
