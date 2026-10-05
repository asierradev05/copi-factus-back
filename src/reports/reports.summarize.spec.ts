import { InvoiceKind } from '@prisma/client';
import { summarizeSales, type SalesRow } from './reports.summarize';

// Se usa el contrato real de la funcion en vez de un tipo local. El filtro de
// `status` y de `dianStatus` no vive aqui sino en el `where` de Prisma, asi que
// esta unidad solo cubre la aritmetica; esa exclusion se prueba en
// `reports.spec.ts` contra la base.
const invoice = (total: number, over: Partial<SalesRow> = {}): SalesRow => ({
  documentKind: InvoiceKind.FACTURA,
  total,
  paidAmount: 0,
  balance: total,
  ...over,
});

describe('summarizeSales', () => {
  it('cuenta solo facturas en el conteo de documentos', () => {
    const result = summarizeSales([
      invoice(1000),
      invoice(500, { documentKind: InvoiceKind.NOTA_CREDITO }),
    ]);
    expect(result.invoiceCount).toBe(1);
  });

  it('descuenta la nota credito de las ventas netas', () => {
    const result = summarizeSales([
      invoice(1000),
      invoice(400, { documentKind: InvoiceKind.NOTA_CREDITO }),
    ]);
    expect(result.netSales).toBe('600.00');
  });

  it('suma la nota debito a las ventas netas', () => {
    const result = summarizeSales([
      invoice(1000),
      invoice(300, { documentKind: InvoiceKind.NOTA_DEBITO }),
    ]);
    expect(result.netSales).toBe('1300.00');
  });

  it('expone los totales de cada tipo por separado', () => {
    const result = summarizeSales([
      invoice(1000),
      invoice(400, { documentKind: InvoiceKind.NOTA_CREDITO }),
      invoice(300, { documentKind: InvoiceKind.NOTA_DEBITO }),
    ]);
    expect(result.invoiceTotal).toBe('1000.00');
    expect(result.creditNotesTotal).toBe('400.00');
    expect(result.debitNotesTotal).toBe('300.00');
  });

  it('no suma notas al pendiente ni al cobrado', () => {
    const result = summarizeSales([
      invoice(1000, { paidAmount: 400, balance: 600 }),
      invoice(400, {
        documentKind: InvoiceKind.NOTA_CREDITO,
        paidAmount: 400,
        balance: 0,
      }),
    ]);
    expect(result.totalCollected).toBe('400.00');
    expect(result.totalPending).toBe('600.00');
  });

  it('devuelve ceros cuando no hay documentos', () => {
    const result = summarizeSales([]);
    expect(result.netSales).toBe('0.00');
    expect(result.invoiceCount).toBe(0);
  });
});
