import { chunkCufe, documentLabel, buildDocDefinition } from './invoice-pdf.util';
import { InvoiceKind } from '@prisma/client';

const pdfText = (model: any): string => {
  const doc: any = buildDocDefinition(model, {
    nit: '900123456',
    name: 'ACME',
    address: 'calle 1',
    municipality: 'Bogota',
    municipalityCode: '11001',
    email: 'a@b.co',
    phone: '300',
    regime: 'R-99-PN',
  } as any);
  return JSON.stringify(doc);
};

const baseModel = {
  status: 'EMITIDA',
  subtotal: 100,
  discountTotal: 0,
  taxTotal: 19,
  total: 119,
  paidAmount: 0,
  balance: 119,
  dianStatus: 'VALIDADA',
  customer: { name: 'Cliente', documentType: 'CC', documentNumber: '1' },
  items: [],
};

describe('identificador DIAN en el PDF', () => {
  it('una nota imprime CUDE, no CUFE', () => {
    const text = pdfText({
      ...baseModel,
      documentKind: InvoiceKind.NOTA_CREDITO,
      cude: 'CUDE-1234567890',
    });
    expect(text).toContain('CUDE');
    expect(text).not.toContain('"CUFE"');
  });

  it('una factura sigue imprimiendo CUFE', () => {
    const text = pdfText({
      ...baseModel,
      documentKind: InvoiceKind.FACTURA,
      cufe: 'CUFE-1234567890',
    });
    expect(text).toContain('CUFE');
  });

  it('no imprime fila de identificador cuando no hay ninguno', () => {
    const text = pdfText({
      ...baseModel,
      documentKind: InvoiceKind.NOTA_CREDITO,
    });
    expect(text).not.toContain('CUDE');
    expect(text).not.toContain('CUFE');
  });

  it('prefiere el CUFE si un documento trajera ambos', () => {
    const text = pdfText({
      ...baseModel,
      documentKind: InvoiceKind.FACTURA,
      cufe: 'CUFE-REAL',
      cude: 'CUDE- AJENO',
    });
    expect(text).toContain('CUFE-REAL');
  });
});

describe('documentLabel', () => {
  it('rotula una nota credito como NOTA CREDITO, no como factura', () => {
    expect(documentLabel(InvoiceKind.NOTA_CREDITO)).toBe('NOTA CREDITO');
  });

  it('rotula una nota debito como NOTA DEBITO', () => {
    expect(documentLabel(InvoiceKind.NOTA_DEBITO)).toBe('NOTA DEBITO');
  });

  it('rotula una factura como FACTURA', () => {
    expect(documentLabel(InvoiceKind.FACTURA)).toBe('FACTURA');
  });

  it('cae en FACTURA cuando el tipo falta, para no romper PDFs viejos', () => {
    expect(documentLabel(undefined)).toBe('FACTURA');
    expect(documentLabel(null)).toBe('FACTURA');
  });
});

describe('chunkCufe', () => {
  it('divide el CUFE en grupos de tamaño fijo separados por espacio', () => {
    const cufe = 'A'.repeat(123);
    const result = chunkCufe(cufe, 24);

    expect(result).toBe(
      `${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(24)} ${'A'.repeat(3)}`,
    );
  });

  it('maneja grupos largos sin que la cadena quede sin separadores', () => {
    const result = chunkCufe('abcdefghijklmnopqrstuvwxyz', 8);
    expect(result).toBe('abcdefgh ijklmnop qrstuvwx yz');
  });

  it('devuelve string vacío para nulos o vacíos', () => {
    expect(chunkCufe(null)).toBe('');
    expect(chunkCufe('')).toBe('');
  });
});
