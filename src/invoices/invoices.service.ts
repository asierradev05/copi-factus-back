import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Ambient,
  DianStatus,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../common/email/email.service';
import { generateInvoicePdf } from '../common/pdf/invoice-pdf.util';
import type {
  CompanyPdfModel,
  InvoicePdfModel,
} from '../common/pdf/invoice-pdf.util';
import { generateCufe } from '../common/utils/cufe.util';
import { globalStore } from '../database/in-memory-store';
import {
  calculateLineTotal,
  sumDecimals,
  toDecimal,
} from '../common/utils/money.util';
import { resolveInvoiceStatus } from '../common/utils/invoice-status.util';
import { useInMemoryFallback } from '../common/utils/fallback.util';
import {
  CreateInvoiceDto,
  FilterInvoiceDto,
  SendInvoiceEmailDto,
} from './dto/invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly email: EmailService,
  ) {}

  async findAll(filters: FilterInvoiceDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.InvoiceWhereInput = {};
      if (filters.customerId) where.customerId = filters.customerId;
      if (filters.status) where.status = filters.status as InvoiceStatus;
      if (filters.search) {
        where.OR = [
          { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
          {
            customer: {
              name: { contains: filters.search, mode: 'insensitive' },
            },
          },
          {
            customer: {
              documentNumber: {
                contains: filters.search,
                mode: 'insensitive',
              },
            },
          },
        ];
      }
      if (filters.from || filters.to) {
        where.issueDate = {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lte: new Date(filters.to) } : {}),
        };
      }

      const [rawData, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          include: { customer: true, items: true, payments: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.invoice.count({ where }),
      ]);

      const data = await Promise.all(
        rawData.map((invoice) => this.syncOverdueStatus(invoice)),
      );

      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      if (!useInMemoryFallback()) throw err;

      let filtered = globalStore.invoices;
      if (filters.customerId) {
        filtered = filtered.filter((i) => i.customerId === filters.customerId);
      }
      if (filters.status) {
        filtered = filtered.filter((i) => i.status === filters.status);
      }
      if (filters.search) {
        const term = filters.search.toLowerCase();
        filtered = filtered.filter((i) => {
          const customer = globalStore.customers.find(
            (c) => c.id === i.customerId,
          );
          return (
            (i.invoiceNumber ?? '').toLowerCase().includes(term) ||
            (customer?.name ?? '').toLowerCase().includes(term) ||
            (customer?.documentNumber ?? '').toLowerCase().includes(term)
          );
        });
      }
      if (filters.from || filters.to) {
        filtered = filtered.filter((i) => {
          if (!i.issueDate) return true;
          const date = new Date(i.issueDate).getTime();
          return (
            (!filters.from || date >= new Date(filters.from).getTime()) &&
            (!filters.to || date <= new Date(filters.to).getTime())
          );
        });
      }
      const data = filtered.slice(skip, skip + limit);
      const total = filtered.length;
      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }
  }

  async findOne(id: string) {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id },
        include: {
          customer: true,
          items: { include: { product: true } },
          payments: true,
          serviceLinks: { include: { service: true } },
          purchaseOrders: true,
          deliveryOrders: true,
        },
      });

      if (invoice) {
        return this.syncOverdueStatus(invoice);
      }
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
    }

    const memInvoice = globalStore.invoices.find((i) => i.id === id);
    if (!memInvoice) {
      throw new NotFoundException('Factura no encontrada.');
    }
    return memInvoice;
  }

  async createDraft(dto: CreateInvoiceDto, actorId: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('La factura debe tener al menos un ítem.');
    }

    const computedItems = await this.computeItems(dto.items);
    const totals = this.computeInvoiceTotals(computedItems);

    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      const invoice = await this.prisma.invoice.create({
        data: {
          customerId: dto.customerId,
          dueDate,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          paidAmount: toDecimal(0),
          balance: totals.total,
          status: InvoiceStatus.BORRADOR,
          notes: dto.notes?.trim(),
          createdById: actorId,
          items: {
            create: computedItems.map((item) => ({
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              taxRate: item.taxRate,
              subtotal: item.subtotal,
              taxAmount: item.taxAmount,
              total: item.total,
            })),
          },
        },
        include: { items: true, customer: true },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'Invoice',
          entityId: invoice.id,
          newValue: invoice,
        })
        .catch(() => {});

      return invoice;
    } catch (err) {
      if (!useInMemoryFallback()) throw err;

      const invId = randomUUID();
      const totalNum = Number(totals.total);

      const memInvoice = {
        id: invId,
        invoiceNumber: null,
        customerId: dto.customerId,
        dueDate,
        subtotal: Number(totals.subtotal),
        discountTotal: Number(totals.discountTotal),
        taxTotal: Number(totals.taxTotal),
        total: totalNum,
        paidAmount: 0,
        balance: totalNum,
        status: InvoiceStatus.BORRADOR,
        notes: dto.notes?.trim(),
        items: computedItems.map((i, index) => ({
          id: randomUUID(),
          invoiceId: invId,
          ...i,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          discount: Number(i.discount),
          taxRate: Number(i.taxRate),
          subtotal: Number(i.subtotal),
          taxAmount: Number(i.taxAmount),
          total: Number(i.total),
        })),
        payments: [],
      };

      globalStore.invoices.push(memInvoice);
      return memInvoice;
    }
  }

  async emit(id: string, actorId: string) {
    const existing = await this.findOne(id);

    if (existing.status !== InvoiceStatus.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden emitir facturas en estado borrador.',
      );
    }

    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            prefix: string;
            next: number;
            to: number;
            resolution_number: string;
            ambient: string;
          }>
        >`
          SELECT id, prefix, next, "to", resolution_number, is_active, ambient
          FROM resolutions
          WHERE type = 'FACTURA' AND is_active = TRUE AND next <= "to"
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE
        `;

        const resolution = rows[0];
        if (!resolution) {
          throw new BadRequestException(
            'No hay una resolución activa disponible para facturar.',
          );
        }

        const invoiceNumber = `${resolution.prefix}${String(resolution.next).padStart(6, '0')}`;
        const cufe = generateCufe(
          invoiceNumber,
          JSON.stringify({
            customerId: existing.customerId,
            total: Number(existing.total),
          }),
        );

        await tx.resolution.update({
          where: { id: resolution.id },
          data: { next: resolution.next + 1 },
        });

        return tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber,
            issueDate: new Date(),
            status: InvoiceStatus.EMITIDA,
            resolutionId: resolution.id,
            resolutionNumber: resolution.resolution_number,
            resolutionDate: new Date(),
            ambient: resolution.ambient as Ambient,
            cufe,
            dianStatus: DianStatus.PENDIENTE,
          },
          include: { items: true, customer: true },
        });
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.EMIT,
          entityType: 'Invoice',
          entityId: invoice.id,
          oldValue: { status: existing.status },
          newValue: invoice,
        })
        .catch(() => {});

      return invoice;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (!useInMemoryFallback()) throw err;

      const nextNum = globalStore.companySettings.invoiceNextNumber++;
      existing.invoiceNumber = `${globalStore.companySettings.invoicePrefix}-${String(nextNum).padStart(6, '0')}`;
      existing.issueDate = new Date();
      existing.status = InvoiceStatus.EMITIDA;
      existing.cufe = generateCufe(
        existing.invoiceNumber,
        JSON.stringify({
          customerId: existing.customerId,
          total: Number(existing.total ?? 0),
        }),
      );
      existing.dianStatus = DianStatus.PENDIENTE;
      return existing;
    }
  }

  async cancel(id: string, actorId: string) {
    const existing = await this.findOne(id);

    if (existing.status === InvoiceStatus.CANCELADA) {
      throw new BadRequestException('La factura ya está cancelada.');
    }

    const paidNum = Number(existing.paidAmount);
    if (paidNum > 0) {
      throw new BadRequestException(
        'No se puede cancelar una factura con pagos registrados.',
      );
    }

    try {
      const invoice = await this.prisma.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.CANCELADA,
          cancelledAt: new Date(),
          balance: toDecimal(0),
        },
        include: { items: true, customer: true },
      });

      return invoice;
    } catch (err) {
      if (!useInMemoryFallback()) throw err;

      existing.status = InvoiceStatus.CANCELADA;
      existing.cancelledAt = new Date();
      existing.balance = 0;
      return existing;
    }
  }

  async getPdfContext(id: string) {
    const invoice = await this.findOne(id);
    const company = await this.getCompanyPdfModel();
    return { invoice: this.toPdfModel(invoice), company };
  }

  async getPdfBuffer(id: string): Promise<Buffer> {
    const { invoice, company } = await this.getPdfContext(id);
    return generateInvoicePdf(invoice, company);
  }

  async sendInvoiceEmail(
    id: string,
    dto: SendInvoiceEmailDto,
    actorId: string,
  ) {
    const invoice = await this.findOne(id);

    if (invoice.status === InvoiceStatus.BORRADOR) {
      throw new BadRequestException(
        'No se puede enviar una factura en estado borrador.',
      );
    }

    if (!invoice.invoiceNumber) {
      throw new BadRequestException(
        'La factura aún no tiene un número asignado.',
      );
    }

    const customer = invoice.customer
      ? invoice.customer
      : globalStore.customers.find((c) => c.id === invoice.customerId);
    const targetEmail = (dto.to ?? '').trim() || customer?.email || null;

    if (!targetEmail) {
      throw new BadRequestException(
        'Debe indicar un correo de destino o registrar el correo del cliente.',
      );
    }

    const company = await this.getCompanyPdfModel();
    const pdfBuffer = await generateInvoicePdf(
      this.toPdfModel(invoice),
      company,
    );

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5175';
    const esc = (v: string | null | undefined) =>
      (v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const html = `
      <div style="font-family:Arial, sans-serif; color:#222;">
        <h2>${esc(company.name)}</h2>
        <p>Cordial saludo${customer ? `, <b>${esc(customer.name)}</b>` : ''}.</p>
        <p>Adjuntamos la factura de venta <b>${esc(invoice.invoiceNumber)}</b>
        por un total de <b>${Number(invoice.total).toLocaleString('es-CO', { minimumFractionDigits: 2 })}</b>.</p>
        <p>Puede consultarla en línea: <a href="${esc(frontendUrl)}/invoices/${id}">Ver factura</a></p>
        <p style="color:#888; font-size:12px;">Este mensaje fue generado automáticamente por ${esc(company.name)}.</p>
      </div>
    `;

    const result = await this.email.sendMail({
      to: targetEmail,
      subject: `Factura ${invoice.invoiceNumber} - ${company.name}`,
      html,
      attachments: [
        { filename: `${invoice.invoiceNumber}.pdf`, content: pdfBuffer },
      ],
    });

    try {
      await this.prisma.invoice.update({
        where: { id },
        data: { emailSentAt: new Date() },
      });
    } catch {
      invoice.emailSentAt = new Date();
    }

    await this.auditService
      .log({
        userId: actorId,
        action: AuditAction.UPDATE,
        entityType: 'Invoice',
        entityId: id,
        newValue: { emailSentAt: new Date(), to: targetEmail },
      })
      .catch(() => {});

    return {
      success: true,
      messageId: result.messageId,
      to: targetEmail,
      simulated: result.simulated,
    };
  }

  private toPdfModel(invoice: any): InvoicePdfModel {
    const customer = invoice.customer
      ? invoice.customer
      : (globalStore.customers.find((c) => c.id === invoice.customerId) ??
        null);

    return {
      invoiceNumber: invoice.invoiceNumber ?? null,
      issueDate: invoice.issueDate ?? null,
      dueDate: invoice.dueDate ?? null,
      status: invoice.status,
      subtotal: Number(invoice.subtotal ?? 0),
      discountTotal: Number(invoice.discountTotal ?? 0),
      taxTotal: Number(invoice.taxTotal ?? 0),
      total: Number(invoice.total ?? 0),
      paidAmount: Number(invoice.paidAmount ?? 0),
      balance: Number(invoice.balance ?? invoice.total ?? 0),
      notes: invoice.notes ?? null,
      cufe: invoice.cufe ?? null,
      dianStatus: invoice.dianStatus ?? 'NO_APLICA',
      resolutionNumber: invoice.resolutionNumber ?? null,
      resolutionDate: invoice.resolutionDate ?? null,
      customer: {
        name: customer?.name ?? 'Cliente',
        documentType: customer?.documentType ?? null,
        documentNumber: customer?.documentNumber ?? null,
        address: customer?.address ?? null,
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        city: customer?.city ?? null,
      },
      items: (invoice.items ?? []).map((item: any) => ({
        description: item.description ?? '',
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unitPrice ?? 0),
        discount: Number(item.discount ?? 0),
        taxRate: Number(item.taxRate ?? 0),
        subtotal: Number(item.subtotal ?? 0),
        taxAmount: Number(item.taxAmount ?? 0),
        total: Number(item.total ?? 0),
      })),
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

  async recalculateBalance(invoiceId: string, tx?: Prisma.TransactionClient) {
    try {
      const client = tx ?? this.prisma;
      const invoice = await client.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      });

      if (invoice) {
        const paidAmount = sumDecimals(invoice.payments.map((p) => p.amount));
        const balance = invoice.total.sub(paidAmount);
        const newStatus = resolveInvoiceStatus(
          invoice.total,
          paidAmount,
          invoice.dueDate,
          invoice.status,
        );

        return await client.invoice.update({
          where: { id: invoiceId },
          data: {
            paidAmount,
            balance: balance.lessThan(0) ? toDecimal(0) : balance,
            status: newStatus,
          },
          include: { items: true, customer: true, payments: true },
        });
      }
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
    }

    const memInvoice = globalStore.invoices.find((i) => i.id === invoiceId);
    if (!memInvoice) {
      throw new NotFoundException('Factura no encontrada.');
    }

    const paidSum = memInvoice.payments.reduce(
      (acc: number, p: any) => acc + Number(p.amount),
      0,
    );
    memInvoice.paidAmount = paidSum;
    const rem = Number(memInvoice.total) - paidSum;
    memInvoice.balance = rem < 0 ? 0 : rem;

    if (rem <= 0) {
      memInvoice.status = InvoiceStatus.PAGADA;
    } else if (paidSum > 0) {
      memInvoice.status = InvoiceStatus.PARCIALMENTE_PAGADA;
    }

    return memInvoice;
  }

  private async syncOverdueStatus<T extends any>(invoice: T): Promise<T> {
    return invoice;
  }

  private async computeItems(items: CreateInvoiceDto['items']) {
    return Promise.all(
      items.map(async (item) => {
        const { subtotal, taxAmount, total } = calculateLineTotal(
          item.quantity,
          item.unitPrice,
          item.discount ?? 0,
          item.taxRate ?? 0,
        );

        return {
          productId: item.productId,
          description: item.description.trim(),
          quantity: toDecimal(item.quantity),
          unitPrice: toDecimal(item.unitPrice),
          discount: toDecimal(item.discount ?? 0),
          taxRate: toDecimal(item.taxRate ?? 0),
          subtotal,
          taxAmount,
          total,
        };
      }),
    );
  }

  private computeInvoiceTotals(
    items: Array<{
      subtotal: Decimal;
      discount: Decimal;
      taxAmount: Decimal;
      total: Decimal;
    }>,
  ) {
    const subtotal = sumDecimals(items.map((i) => i.subtotal));
    const discountTotal = sumDecimals(items.map((i) => i.discount));
    const taxTotal = sumDecimals(items.map((i) => i.taxAmount));
    const total = sumDecimals(items.map((i) => i.total));

    return { subtotal, discountTotal, taxTotal, total };
  }
}
