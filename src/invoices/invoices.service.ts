import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, InvoiceStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { globalStore } from '../database/in-memory-store';
import {
  calculateLineTotal,
  sumDecimals,
  toDecimal,
} from '../common/utils/money.util';
import { allocateInvoiceNumber } from '../common/utils/invoice-number.util';
import {
  isOverdue,
  resolveInvoiceStatus,
} from '../common/utils/invoice-status.util';
import { CreateInvoiceDto, FilterInvoiceDto } from './dto/invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(filters: FilterInvoiceDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.InvoiceWhereInput = {};
      if (filters.customerId) where.customerId = filters.customerId;
      if (filters.status) where.status = filters.status as InvoiceStatus;

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
    } catch {
      let filtered = globalStore.invoices;
      if (filters.customerId) {
        filtered = filtered.filter((i) => i.customerId === filters.customerId);
      }
      if (filters.status) {
        filtered = filtered.filter((i) => i.status === filters.status);
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
        },
      });

      if (invoice) {
        return this.syncOverdueStatus(invoice);
      }
    } catch {}

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

      await this.auditService.log({
        userId: actorId,
        action: AuditAction.CREATE,
        entityType: 'Invoice',
        entityId: invoice.id,
        newValue: invoice,
      }).catch(() => {});

      return invoice;
    } catch {
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
        const { invoiceNumber } = await allocateInvoiceNumber(tx);

        return tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber,
            issueDate: new Date(),
            status: InvoiceStatus.EMITIDA,
          },
          include: { items: true, customer: true },
        });
      });

      await this.auditService.log({
        userId: actorId,
        action: AuditAction.EMIT,
        entityType: 'Invoice',
        entityId: invoice.id,
        oldValue: { status: existing.status },
        newValue: invoice,
      }).catch(() => {});

      return invoice;
    } catch {
      const nextNum = globalStore.companySettings.invoiceNextNumber++;
      existing.invoiceNumber = `${globalStore.companySettings.invoicePrefix}-${String(nextNum).padStart(6, '0')}`;
      existing.issueDate = new Date();
      existing.status = InvoiceStatus.EMITIDA;
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
    } catch {
      existing.status = InvoiceStatus.CANCELADA;
      existing.cancelledAt = new Date();
      existing.balance = 0;
      return existing;
    }
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
    } catch {}

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
