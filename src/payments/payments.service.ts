import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { globalStore } from '../database/in-memory-store';
import { toDecimal } from '../common/utils/money.util';
import { resolveInvoiceStatus } from '../common/utils/invoice-status.util';
import { CreatePaymentDto, FilterPaymentDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(filters: FilterPaymentDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.PaymentWhereInput = {};
      if (filters.invoiceId) where.invoiceId = filters.invoiceId;
      if (filters.customerId) where.customerId = filters.customerId;

      const [data, total] = await Promise.all([
        this.prisma.payment.findMany({
          where,
          include: {
            invoice: true,
            customer: true,
            createdBy: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { paymentDate: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.payment.count({ where }),
      ]);

      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch {
      let filtered = globalStore.payments;
      if (filters.invoiceId) {
        filtered = filtered.filter((p) => p.invoiceId === filters.invoiceId);
      }
      if (filters.customerId) {
        filtered = filtered.filter((p) => p.customerId === filters.customerId);
      }
      const data = filtered.slice(skip, skip + limit);
      const total = filtered.length;
      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }
  }

  async register(dto: CreatePaymentDto, actorId: string) {
    const amountVal = Number(dto.amount);
    if (amountVal <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero.');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({
          where: { id: dto.invoiceId },
          include: { payments: true },
        });

        if (!invoice) {
          throw new NotFoundException('Factura no encontrada.');
        }

        if (
          invoice.status === InvoiceStatus.BORRADOR ||
          invoice.status === InvoiceStatus.CANCELADA
        ) {
          throw new BadRequestException(
            'No se pueden registrar pagos en facturas borrador o canceladas.',
          );
        }

        const totalPaid = invoice.payments.reduce(
          (acc, p) => acc.add(p.amount),
          toDecimal(0),
        );
        const balance = invoice.total.sub(totalPaid);

        if (toDecimal(amountVal).greaterThan(balance)) {
          throw new BadRequestException(
            `El monto excede el saldo pendiente (${balance.toFixed(2)}).`,
          );
        }

        const payment = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            customerId: invoice.customerId,
            amount: toDecimal(amountVal),
            paymentMethod: dto.paymentMethod,
            paymentDate: new Date(dto.paymentDate),
            reference: dto.reference?.trim(),
            notes: dto.notes?.trim(),
            createdById: actorId,
          },
        });

        const newPaidAmount = totalPaid.add(toDecimal(amountVal));
        const newBalance = invoice.total.sub(newPaidAmount);
        const newStatus = resolveInvoiceStatus(
          invoice.total,
          newPaidAmount,
          invoice.dueDate,
          invoice.status,
        );

        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaidAmount,
            balance: newBalance.lessThan(0) ? toDecimal(0) : newBalance,
            status: newStatus,
          },
        });

        return { payment, updatedInvoice };
      });

      await this.auditService.log({
        userId: actorId,
        action: AuditAction.PAYMENT,
        entityType: 'Payment',
        entityId: result.payment.id,
        newValue: result.payment,
      }).catch(() => {});

      return result;
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) {
        throw err;
      }

      const invoice = globalStore.invoices.find((i) => i.id === dto.invoiceId);
      if (!invoice) {
        throw new NotFoundException('Factura no encontrada.');
      }

      if (
        invoice.status === InvoiceStatus.BORRADOR ||
        invoice.status === InvoiceStatus.CANCELADA
      ) {
        throw new BadRequestException(
          'No se pueden registrar pagos en facturas borrador o canceladas.',
        );
      }

      const currentBalance = Number(invoice.balance);
      if (amountVal > currentBalance) {
        throw new BadRequestException(
          `El monto excede el saldo pendiente (${currentBalance}).`,
        );
      }

      const payId = randomUUID();
      const payment = {
        id: payId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: amountVal,
        paymentMethod: dto.paymentMethod,
        paymentDate: new Date(dto.paymentDate),
        reference: dto.reference?.trim(),
        notes: dto.notes?.trim(),
        createdById: actorId,
        createdAt: new Date(),
      };

      globalStore.payments.push(payment);
      if (!invoice.payments) invoice.payments = [];
      invoice.payments.push(payment);

      const newPaid = Number(invoice.paidAmount || 0) + amountVal;
      const newBal = Number(invoice.total) - newPaid;
      invoice.paidAmount = newPaid;
      invoice.balance = newBal < 0 ? 0 : newBal;

      if (newBal <= 0) {
        invoice.status = InvoiceStatus.PAGADA;
      } else {
        invoice.status = InvoiceStatus.PARCIALMENTE_PAGADA;
      }

      return { payment, updatedInvoice: invoice };
    }
  }
}
