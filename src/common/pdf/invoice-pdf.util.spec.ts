import {
  buildDocDefinition,
  generateInvoicePdf,
} from './invoice-pdf.util';
import type { CompanyPdfModel, InvoicePdfModel } from './invoice-pdf.util';

const company: CompanyPdfModel = {
  name: 'Copigráficas Sierra',
  legalName: 'COPIGRÁFICAS SIERRA S.A.S.',
  taxId: '900123456-7',
  address: 'Calle 1 # 2-3',
  city: 'Bogotá',
  phone: '3001234567',
  email: 'ventas@copigraf.cosas',
};

function baseInvoice(overrides: Partial<InvoicePdfModel> = {}): InvoicePdfModel {
  return {
    invoiceNumber: 'FV-000001',
    issueDate: new Date('2026-09-12'),
    dueDate: new Date('2026-10-12'),
    status: 'EMITIDA',
    subtotal: 100000,
    discountTotal: 0,
    taxTotal: 19000,
    total: 119000,
    paidAmount: 0,
    balance: 119000,
    notes: null,
    cufe: null,
    dianStatus: 'NO_APLICA',
    resolutionNumber: null,
    resolutionDate: null,
    referenceCode: null,
    factusNumber: null,
    publicUrl: null,
    qrBase64: null,
    paymentForm: null,
    paymentMethods: [],
    cashRoundingAmount: null,
    dianErrors: [],
    customer: {
      name: 'Cliente Demo',
      documentType: 'NIT',
      documentNumber: '800123456-5',
      address: 'Calle 9 # 10-11',
      phone: '3100000000',
      email: 'cliente@demo.com',
      city: 'Medellín',
    },
    items: [
      {
        description: 'Impresión flyers A4 full color',
        quantity: 1000,
        unitPrice: 100,
        discount: 0,
        taxRate: 19,
        subtotal: 100000,
        taxAmount: 19000,
        total: 119000,
      },
    ],
    ...overrides,
  };
}

describe('invoice-pdf.util (rediseño DIAN)', () => {
  it('genera un Buffer PDF válido para una factura sin datos DIAN', async () => {
    const buffer = await generateInvoicePdf(baseInvoice(), company);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('incluye bloque DIAN completo (número oficial, CUFE, QR, resolución) cuando existe factusNumber', () => {
    const doc = buildDocDefinition(
      baseInvoice({
        dianStatus: 'VALIDADA',
        factusNumber: 'FAC-2026-000123',
        cufe: 'CUFEDIANDEMO123456789',
        referenceCode: 'REF-1001',
        qrBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        publicUrl: 'https://factus.demo/public/FAC-2026-000123',
        resolutionNumber: '18760000001',
        resolutionDate: new Date('2026-01-15'),
        paymentForm: 2,
        paymentMethods: ['Transferencia'],
        cashRoundingAmount: 4,
      }),
      company,
    );

    const json = JSON.stringify(doc);
    expect(json).toContain('Número oficial DIAN');
    expect(json).toContain('FAC-2026-000123');
    expect(json).toContain('CUFEDIANDEMO123456789');
    expect(json).toContain('data:image/png;base64');
    expect(json).toContain('REF-1001');
    expect(json).toContain('Crédito');
    expect(json).toContain('Transferencia');
    expect(json).toContain('4,00');
    expect(json).toContain('Validada');
  });

  it('no muestra QR ni número oficial cuando la factura no pasó por Factus', () => {
    const json = JSON.stringify(buildDocDefinition(baseInvoice(), company));
    expect(json).not.toContain('Número oficial DIAN');
    expect(json).not.toContain('data:image/');
    expect(json).not.toContain('CUFED');
  });

  it('incluye los errores DIAN cuando la factura es RECHAZADA', () => {
    const json = JSON.stringify(
      buildDocDefinition(
        baseInvoice({
          dianStatus: 'RECHAZADA',
          factusNumber: 'FAC-2026-000124',
          dianErrors: [{ message: 'El documento de identificación no está habilitado.' }],
        }),
        company,
      ),
    );
    expect(json).toContain('El documento de identificación no está habilitado.');
  });

  it('desglosa el IVA por línea con porcentaje y monto', () => {
    const json = JSON.stringify(buildDocDefinition(baseInvoice(), company));
    expect(json).toContain('19,00% · 19.000,00');
  });
});