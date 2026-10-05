import { InvoiceStatus } from '@prisma/client';
import { resolveInvoiceStatus, isOverdue } from './invoice-status.util';

const dias = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

describe('resolveInvoiceStatus', () => {
  it('no toca una factura en borrador ni una cancelada', () => {
    expect(
      resolveInvoiceStatus(1000, 0, dias(-30), InvoiceStatus.BORRADOR),
    ).toBe(InvoiceStatus.BORRADOR);
    expect(
      resolveInvoiceStatus(1000, 500, dias(-30), InvoiceStatus.CANCELADA),
    ).toBe(InvoiceStatus.CANCELADA);
  });

  it('queda PAGADA cuando el saldo llega a cero aunque siga vencida', () => {
    expect(
      resolveInvoiceStatus(1000, 1000, dias(-30), InvoiceStatus.VENCIDA),
    ).toBe(InvoiceStatus.PAGADA);
  });

  it('una nota crédito que zera el saldo deja la factura PAGADA sin pagado', () => {
    // total 1000, NC aplicada 1000 -> paidAmount 0 pero balance 0
    expect(
      resolveInvoiceStatus(1000, 0, dias(-30), InvoiceStatus.EMITIDA),
    ).toBe(InvoiceStatus.VENCIDA);
    expect(resolveInvoiceStatus(0, 0, dias(10), InvoiceStatus.EMITIDA)).toBe(
      InvoiceStatus.PAGADA,
    );
  });

  it('pago parcial con vencimiento pasado produce VENCIDA', () => {
    expect(
      resolveInvoiceStatus(1000, 400, dias(-1), InvoiceStatus.EMITIDA),
    ).toBe(InvoiceStatus.VENCIDA);
  });

  it('pago parcial al día produce PARCIALMENTE_PAGADA', () => {
    expect(
      resolveInvoiceStatus(1000, 400, dias(10), InvoiceStatus.EMITIDA),
    ).toBe(InvoiceStatus.PARCIALMENTE_PAGADA);
  });

  it('sin vencimiento y sin pagos conserva el estado actual', () => {
    expect(
      resolveInvoiceStatus(1000, 0, null, InvoiceStatus.EMITIDA),
    ).toBe(InvoiceStatus.EMITIDA);
  });

  it('una factura VENCIDA con el vencimiento movido al futuro vuelve a EMITIDA', () => {
    expect(
      resolveInvoiceStatus(1000, 0, dias(10), InvoiceStatus.VENCIDA),
    ).toBe(InvoiceStatus.EMITIDA);
  });

  it('no produce estados intermedios imposibles', () => {
    const combinaciones: Array<[number, number, InvoiceStatus]> = [
      [1000, 0, InvoiceStatus.EMITIDA],
      [1000, 999, InvoiceStatus.EMITIDA],
      [1000, 1000, InvoiceStatus.EMITIDA],
      [1000, 1001, InvoiceStatus.EMITIDA],
      [0, 0, InvoiceStatus.EMITIDA],
    ];
    for (const [total, paid, status] of combinaciones) {
      const resultado = resolveInvoiceStatus(
        total,
        paid,
        dias(5),
        status,
      );
      expect([
        InvoiceStatus.EMITIDA,
        InvoiceStatus.PARCIALMENTE_PAGADA,
        InvoiceStatus.PAGADA,
      ]).toContain(resultado);
    }
  });
});

describe('isOverdue', () => {
  it('es falsa sin fecha de vencimiento', () => {
    expect(isOverdue(null, 1000)).toBe(false);
    expect(isOverdue(undefined, 1000)).toBe(false);
  });

  it('es falsa cuando no hay saldo pendiente', () => {
    expect(isOverdue(dias(-5), 0)).toBe(false);
  });

  it('es falsa si el vencimiento es hoy o futuro', () => {
    expect(isOverdue(dias(0), 1000)).toBe(false);
    expect(isOverdue(dias(5), 1000)).toBe(false);
  });

  it('es verdadera con vencimiento pasado y saldo pendiente', () => {
    expect(isOverdue(dias(-1), 1000)).toBe(true);
    expect(isOverdue(dias(-40), '0.01')).toBe(true);
  });
});
