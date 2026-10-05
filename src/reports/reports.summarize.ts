import { Decimal } from '@prisma/client/runtime/client';
import { InvoiceKind } from '@prisma/client';

export interface SalesRow {
  documentKind: InvoiceKind;
  total: Decimal | number | string;
  paidAmount: Decimal | number | string;
  balance: Decimal | number | string;
}

export interface SalesSummary {
  invoiceCount: number;
  invoiceTotal: string;
  creditNotesTotal: string;
  debitNotesTotal: string;
  netSales: string;
  totalCollected: string;
  totalPending: string;
}

const dec = (v: Decimal | number | string): Decimal =>
  v instanceof Decimal ? v : new Decimal(v);

/**
 * Las notas no son ventas: una nota credito devuelve mercancia y una nota
 * debito agrega conceptos. Sumarlas con signo positivo inflaba los ingresos y
 * el reporte de cartera, asi que se acumulan aparte y las ventas se presentan
 * netas.
 */
export function summarizeSales(rows: SalesRow[]): SalesSummary {
  let invoiceTotal = new Decimal(0);
  let creditNotesTotal = new Decimal(0);
  let debitNotesTotal = new Decimal(0);
  let totalCollected = new Decimal(0);
  let totalPending = new Decimal(0);
  let invoiceCount = 0;

  for (const row of rows) {
    const total = dec(row.total);

    if (row.documentKind === InvoiceKind.NOTA_CREDITO) {
      creditNotesTotal = creditNotesTotal.add(total);
      continue;
    }

    if (row.documentKind === InvoiceKind.NOTA_DEBITO) {
      debitNotesTotal = debitNotesTotal.add(total);
      continue;
    }

    invoiceCount += 1;
    invoiceTotal = invoiceTotal.add(total);
    totalCollected = totalCollected.add(dec(row.paidAmount));
    totalPending = totalPending.add(dec(row.balance));
  }

  const netSales = invoiceTotal.sub(creditNotesTotal).add(debitNotesTotal);

  return {
    invoiceCount,
    invoiceTotal: invoiceTotal.toFixed(2),
    creditNotesTotal: creditNotesTotal.toFixed(2),
    debitNotesTotal: debitNotesTotal.toFixed(2),
    netSales: netSales.toFixed(2),
    totalCollected: totalCollected.toFixed(2),
    totalPending: totalPending.toFixed(2),
  };
}