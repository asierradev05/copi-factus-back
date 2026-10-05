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
import { useInMemoryFallback } from '../common/utils/fallback.util';
import { toDecimal } from '../common/utils/money.util';
import { isPayableDocument } from '../common/utils/invoice-credit.util';
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
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
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

        if (!isPayableDocument(invoice.documentKind)) {
          throw new BadRequestException(
            'Una nota crédito no admite pagos: su efecto ya se aplicó al saldo de la factura de origen.',
          );
        }

        // Lo ya pagado se lee del ledger (`paidAmount`), no de la suma de
        // `payments`: la compensacion de credito a favor descuenta el saldo
        // escribiendo `paidAmount` sin crear filas de pago. Sumar solo `payments`
        // veria cero y admitiria un segundo pago del mismo monto, ademas de
        // sobrescribir el `paidAmount` ya compensado.
        const paymentsTotal = invoice.payments.reduce(
          (acc, p) => acc.add(p.amount),
          toDecimal(0),
        );
        const ledgerTotal = toDecimal(invoice.paidAmount ?? 0);
        // Se toma el mayor de los dos para que ningun desajuste historico
        // permita cobrar de mas.
        const totalPaid = ledgerTotal.greaterThan(paymentsTotal)
          ? ledgerTotal
          : paymentsTotal;

        const balance = invoice.total
          .sub(totalPaid)
          .sub(toDecimal(invoice.creditBalance ?? 0));

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
        const newBalance = invoice.total
          .sub(newPaidAmount)
          .sub(toDecimal(invoice.creditBalance ?? 0));
        const newStatus = resolveInvoiceStatus(
          invoice.total.sub(toDecimal(invoice.creditBalance ?? 0)),
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

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.PAYMENT,
          entityType: 'Payment',
          entityId: result.payment.id,
          newValue: result.payment,
        })
        .catch(() => {});

      return result;
    } catch (err: any) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      if (!useInMemoryFallback()) throw err;

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
