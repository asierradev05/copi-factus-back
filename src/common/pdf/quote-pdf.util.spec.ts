import {
  buildQuoteDocDefinition,
  generateQuotePdf,
  type QuotePdfModel,
} from './quote-pdf.util';
import type { CompanyPdfModel } from './invoice-pdf.util';

const company: CompanyPdfModel = {
  name: 'CopiGráfica Sierra',
  legalName: 'CopiGráfica Sierra SAS',
  taxId: '900123456-7',
  address: 'Cra 12 # 34-56',
  phone: '3001234567',
  email: 'facturacion@copigraficassierra.com',
  city: 'Bogotá D.C.',
};

const quote: QuotePdfModel = {
  quoteNumber: 'COT-0001',
  issuedAt: new Date('2026-09-12'),
  validUntil: new Date('2026-10-12'),
  customerName: 'Cliente Demo',
  lines: [
    {
      description: 'Láminas adhesivas',
      quantity: 10,
      unitPrice: 2000,
      taxRate: 19,
    },
  ],
  subtotal: 20000,
  taxTotal: 3800,
  total: 23800,
};

describe('generateQuotePdf', () => {
  it('genera un PDF válido en memoria', async () => {
    const buffer = await generateQuotePdf(quote, company, 'PENDIENTE');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('construye el documento con la empresa y los totales', () => {
    const doc = buildQuoteDocDefinition(quote, company, 'PENDIENTE');

    expect(doc.pageSize).toBe('LETTER');
    expect(JSON.stringify(doc.content)).toContain('COTIZACIÓN COT-0001');
    expect(JSON.stringify(doc.content)).toContain('23.800,00');
  });
});
