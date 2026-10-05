import { DianStatus, InvoiceKind, InvoiceStatus, Prisma } from '@prisma/client';

/**
 * Una nota credito no es exigible por si misma (su efecto ya se aplico al saldo
 * de la factura origen), pero una nota debito si aumenta lo adeudado y es
 * cobrable. La cartera se construye con ambos; incluir notas credito como si
 * fueran cobros duplicaria el saldo del cliente.
 */
const RECEIVABLE_KINDS: InvoiceKind[] = [
  InvoiceKind.FACTURA,
  InvoiceKind.NOTA_DEBITO,
];

const RECEIVABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.EMITIDA,
  InvoiceStatus.PARCIALMENTE_PAGADA,
  InvoiceStatus.VENCIDA,
];

/**
 * Un documento que la DIAN rechazo jamas es exigible, aunque por un descuido
 * quedara con un estado interno cobrable. Se filtra de forma explicita para que
 * la cartera no dependa solo del status interno.
 */
const NOT_REJECTED: Prisma.InvoiceWhereInput = {
  dianStatus: { not: DianStatus.RECHAZADA },
};

export function buildReceivableWhere(): Prisma.InvoiceWhereInput {
  return {
    documentKind: { in: RECEIVABLE_KINDS },
    status: { in: RECEIVABLE_STATUSES },
    balance: { gt: 0 },
    AND: [NOT_REJECTED],
  };
}

export function buildReceivableSummaryWhere(): Prisma.InvoiceWhereInput {
  return {
    documentKind: { in: RECEIVABLE_KINDS },
    status: { in: RECEIVABLE_STATUSES },
    AND: [NOT_REJECTED],
  };
}
