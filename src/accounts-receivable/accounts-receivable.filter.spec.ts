import { InvoiceKind, InvoiceStatus } from '@prisma/client';
import { buildReceivableWhere, buildReceivableSummaryWhere } from './accounts-receivable.filter';

describe('buildReceivableWhere', () => {
  it('incluye facturas y notas debito, que son exigibles', () => {
    expect(buildReceivableWhere().documentKind).toEqual({
      in: [InvoiceKind.FACTURA, InvoiceKind.NOTA_DEBITO],
    });
  });

  it('excluye notas credito porque ya se aplico a su factura origen', () => {
    const where = buildReceivableWhere();
    expect(where.documentKind).not.toEqual(InvoiceKind.NOTA_CREDITO);
    expect(
      (where.documentKind as { in: InvoiceKind[] }).in,
    ).not.toContain(InvoiceKind.NOTA_CREDITO);
  });

  it('solo considera documentos con saldo por cobrar', () => {
    expect(buildReceivableWhere().balance).toEqual({ gt: 0 });
  });

  it('el resumen aplica el mismo filtro de tipo que el listado', () => {
    expect(buildReceivableSummaryWhere().documentKind).toEqual({
      in: [InvoiceKind.FACTURA, InvoiceKind.NOTA_DEBITO],
    });
  });

  it('el resumen excluye los mismos estados que el listado', () => {
    expect(buildReceivableSummaryWhere().status).toEqual(
      buildReceivableWhere().status,
    );
  });

  it('mantiene los estados que implican saldo abierto', () => {
    const states = (
      buildReceivableWhere().status as { in: InvoiceStatus[] }
    ).in;
    expect(states).toContain(InvoiceStatus.EMITIDA);
    expect(states).toContain(InvoiceStatus.PARCIALMENTE_PAGADA);
    expect(states).toContain(InvoiceStatus.VENCIDA);
    expect(states).not.toContain(InvoiceStatus.BORRADOR);
  });
});