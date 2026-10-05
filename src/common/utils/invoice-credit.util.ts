import { InvoiceKind, InvoiceStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { toDecimal } from './money.util';
import { resolveInvoiceStatus } from './invoice-status.util';

/**
 * Una nota credito no es exigible por separado: su efecto ya se aplico al
 * saldo de la factura origen. Admitir pagos sobre ella permitiria cambiar su
 * estado, sacarla del computo de credito acreditado y sobre-acreditar la
 * factura original.
 */
export function isPayableDocument(documentKind: InvoiceKind | null | undefined): boolean {
  return documentKind !== InvoiceKind.NOTA_CREDITO;
}

/**
 * Una nota puedeREFERENCE una factura que ya esta pagada: la devolucion tras
 * el pago es el caso mas comun. Exigir EMITIDA rompia la correccion en varias
 * notas, porque la primera nota usually deja la factura en PAGADA y bloqueaba
 * la segunda. Solo se excluyen los estados donde la nota no tiene sentido: un
 * borrador aun no emitido y una factura anulada.
 */
export function isNoteSourceStatus(status: InvoiceStatus | null | undefined): boolean {
  return (
    status === InvoiceStatus.EMITIDA ||
    status === InvoiceStatus.PARCIALMENTE_PAGADA ||
    status === InvoiceStatus.PAGADA ||
    status === InvoiceStatus.VENCIDA
  );
}

export interface CreditableInvoice {
  total: Decimal | string | number;
  paidAmount: Decimal | string | number;
  balance: Decimal | string | number;
  creditBalance: Decimal | string | number;
  dueDate: Date | null | undefined;
  status: InvoiceStatus;
}

export interface CreditApplication {
  balance: Decimal;
  creditBalance: Decimal;
  status: InvoiceStatus;
}

/**
 * Aplica una nota credito sobre su factura origen.
 *
 * El credito reduce el saldo pendiente; si lo supera, el excedente pasa a
 * `creditBalance` (saldo a favor del cliente) en lugar de perderse. El estado se
 * recalcula sobre el saldo resultante para que una factura cubierta por notas
 * quede PAGADA y no siga figurando en cartera.
 */
export function applyCreditToInvoice(
  invoice: CreditableInvoice,
  credit: Decimal | string | number,
): CreditApplication {
  const currentCredit = toDecimal(invoice.creditBalance ?? 0);
  const balanceBefore = toDecimal(invoice.balance);

  if (
    invoice.status === InvoiceStatus.CANCELADA ||
    invoice.status === InvoiceStatus.BORRADOR
  ) {
    return {
      balance: balanceBefore,
      creditBalance: currentCredit,
      status: invoice.status,
    };
  }

  const applied = toDecimal(credit);
  if (applied.lessThanOrEqualTo(0)) {
    return {
      balance: balanceBefore,
      creditBalance: currentCredit,
      status: invoice.status,
    };
  }

  const covered = Decimal.min(applied, balanceBefore);
  const excess = applied.sub(covered);
  const newBalance = balanceBefore.sub(covered);
  const newCredit = currentCredit.add(excess);

  const totalDec = toDecimal(invoice.total);
  const effectivePaid = totalDec.sub(newBalance);

  return {
    balance: newBalance,
    creditBalance: newCredit,
    status: resolveInvoiceStatus(
      totalDec,
      effectivePaid,
      invoice.dueDate,
      invoice.status,
    ),
  };
}

export interface CustomerCreditSource {
  invoiceId: string;
  available: Decimal | string | number;
}

export interface CreditAllocation {
  applied: Decimal;
  consumed: Map<string, Decimal>;
}

/**
 * Reparte credito a favor del cliente para compensar una nueva factura,
 * consumiendo primero el credito mas antiguo.
 */
export function allocateCustomerCredit(
  sources: CustomerCreditSource[],
  amount: Decimal | string | number,
): CreditAllocation {
  const consumed = new Map<string, Decimal>();
  let remaining = toDecimal(amount);

  if (remaining.lessThanOrEqualTo(0)) {
    return { applied: new Decimal(0), consumed };
  }

  for (const source of sources) {
    if (remaining.lessThanOrEqualTo(0)) {
      break;
    }
    const available = toDecimal(source.available ?? 0);
    if (available.lessThanOrEqualTo(0)) {
      continue;
    }
    const used = Decimal.min(available, remaining);
    remaining = remaining.sub(used);
    consumed.set(
      source.invoiceId,
      (consumed.get(source.invoiceId) ?? new Decimal(0)).add(used),
    );
  }

  return {
    applied: toDecimal(amount).sub(remaining),
    consumed,
  };
}