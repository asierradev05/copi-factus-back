import { InvoiceKind, InvoiceStatus } from '@prisma/client';
import {
  applyCreditToInvoice,
  allocateCustomerCredit,
  isPayableDocument,
  isNoteSourceStatus,
} from './invoice-credit.util';

const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

const invoice = (over: Partial<Record<string, unknown>> = {}) => ({
  total: 1000,
  paidAmount: 0,
  balance: 1000,
  creditBalance: 0,
  dueDate: inThreeDays,
  status: InvoiceStatus.EMITIDA,
  ...over,
});

describe('applyCreditToInvoice', () => {
  it('reduce el saldo cuando el credito es menor que el saldo pendiente', () => {
    const result = applyCreditToInvoice(invoice({ paidAmount: 400, balance: 600 }), 200);
    expect(result.balance.toFixed(2)).toBe('400.00');
    expect(result.creditBalance.toFixed(2)).toBe('0.00');
  });

  it('deja la factura PAGADA cuando el credito iguala exactamente el saldo', () => {
    const result = applyCreditToInvoice(invoice({ paidAmount: 400, balance: 600 }), 600);
    expect(result.balance.toFixed(2)).toBe('0.00');
    expect(result.status).toBe(InvoiceStatus.PAGADA);
  });

  it('lleva el excedente a saldo a favor cuando el credito supera el saldo', () => {
    const result = applyCreditToInvoice(invoice({ paidAmount: 1000, balance: 0 }), 250);
    expect(result.balance.toFixed(2)).toBe('0.00');
    expect(result.creditBalance.toFixed(2)).toBe('250.00');
  });

  it('acumula saldo a favor sobre el que ya existia', () => {
    const result = applyCreditToInvoice(
      invoice({ paidAmount: 1000, balance: 0, creditBalance: 40 }),
      250,
    );
    expect(result.creditBalance.toFixed(2)).toBe('290.00');
  });

  it('deja la factura PARCIALMENTE_PAGADA si aun queda saldo', () => {
    const result = applyCreditToInvoice(invoice({ paidAmount: 400, balance: 600 }), 100);
    expect(result.status).toBe(InvoiceStatus.PARCIALMENTE_PAGADA);
  });

  it('no altera facturas canceladas', () => {
    const result = applyCreditToInvoice(
      invoice({ status: InvoiceStatus.CANCELADA, balance: 500 }),
      200,
    );
    expect(result.balance.toFixed(2)).toBe('500.00');
    expect(result.creditBalance.toFixed(2)).toBe('0.00');
  });
});

describe('allocateCustomerCredit', () => {
  const credit = (invoiceId: string, available: number) => ({
    invoiceId,
    available,
  });

  it('consume el credito mas antiguo primero', () => {
    const result = allocateCustomerCredit(
      [credit('a', 100), credit('b', 500)],
      300,
    );
    expect(result.applied.toFixed(2)).toBe('300.00');
    expect(result.consumed.get('a')?.toFixed(2)).toBe('100.00');
    expect(result.consumed.get('b')?.toFixed(2)).toBe('200.00');
  });

  it('no compensa mas que el credito disponible del cliente', () => {
    const result = allocateCustomerCredit([credit('a', 100)], 5000);
    expect(result.applied.toFixed(2)).toBe('100.00');
  });

  it('no compensa mas que el total de la nueva factura', () => {
    const result = allocateCustomerCredit([credit('a', 900)], 250);
    expect(result.applied.toFixed(2)).toBe('250.00');
    expect(result.consumed.get('a')?.toFixed(2)).toBe('250.00');
  });

  it('devuelve cero cuando el cliente no tiene saldo a favor', () => {
    const result = allocateCustomerCredit([], 5000);
    expect(result.applied.toFixed(2)).toBe('0.00');
    expect(result.consumed.size).toBe(0);
  });

  it('omite creditos agotados o negativos', () => {
    const result = allocateCustomerCredit(
      [credit('a', 0), credit('b', -50), credit('c', 80)],
      500,
    );
    expect(result.applied.toFixed(2)).toBe('80.00');
    expect(result.consumed.has('a')).toBe(false);
    expect(result.consumed.has('b')).toBe(false);
  });
});

describe('isNoteSourceStatus', () => {
  it('admite notas sobre una factura pagada, que es el caso de devolucion', () => {
    expect(isNoteSourceStatus(InvoiceStatus.PAGADA)).toBe(true);
  });

  it('admite los estados de una factura viva', () => {
    expect(isNoteSourceStatus(InvoiceStatus.EMITIDA)).toBe(true);
    expect(isNoteSourceStatus(InvoiceStatus.PARCIALMENTE_PAGADA)).toBe(true);
    expect(isNoteSourceStatus(InvoiceStatus.VENCIDA)).toBe(true);
  });

  it('no admite notas sobre un borrador todavia no emitido', () => {
    expect(isNoteSourceStatus(InvoiceStatus.BORRADOR)).toBe(false);
  });

  it('no admite notas sobre una factura anulada', () => {
    expect(isNoteSourceStatus(InvoiceStatus.CANCELADA)).toBe(false);
  });

  it('es falso cuando no hay estado', () => {
    expect(isNoteSourceStatus(null)).toBe(false);
    expect(isNoteSourceStatus(undefined)).toBe(false);
  });
});

describe('isPayableDocument', () => {
  it('una nota credito no admite pagos porque acredita la factura origen', () => {
    expect(isPayableDocument(InvoiceKind.NOTA_CREDITO)).toBe(false);
  });

  it('una nota debito admite pagos porque aumenta lo adeudado', () => {
    expect(isPayableDocument(InvoiceKind.NOTA_DEBITO)).toBe(true);
  });

  it('una factura admite pagos', () => {
    expect(isPayableDocument(InvoiceKind.FACTURA)).toBe(true);
  });
});