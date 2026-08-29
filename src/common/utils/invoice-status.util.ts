import { InvoiceStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { toDecimal } from './money.util';

export function resolveInvoiceStatus(
  total: Decimal | string | number,
  paidAmount: Decimal | string | number,
  dueDate: Date | null | undefined,
  currentStatus: InvoiceStatus,
): InvoiceStatus {
  if (
    currentStatus === InvoiceStatus.CANCELADA ||
    currentStatus === InvoiceStatus.BORRADOR
  ) {
    return currentStatus;
  }

  const totalDec = toDecimal(total);
  const paidDec = toDecimal(paidAmount);
  const balance = totalDec.sub(paidDec);

  if (balance.lessThanOrEqualTo(0)) {
    return InvoiceStatus.PAGADA;
  }

  if (paidDec.greaterThan(0)) {
    if (
      dueDate &&
      dueDate < startOfDay(new Date()) &&
      currentStatus !== InvoiceStatus.VENCIDA
    ) {
      return InvoiceStatus.VENCIDA;
    }
    return InvoiceStatus.PARCIALMENTE_PAGADA;
  }

  if (dueDate && dueDate < startOfDay(new Date())) {
    return InvoiceStatus.VENCIDA;
  }

  return currentStatus === InvoiceStatus.VENCIDA
    ? InvoiceStatus.EMITIDA
    : currentStatus;
}

export function isOverdue(
  dueDate: Date | null | undefined,
  balance: Decimal | string | number,
): boolean {
  if (!dueDate) {
    return false;
  }
  return dueDate < startOfDay(new Date()) && toDecimal(balance).greaterThan(0);
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
