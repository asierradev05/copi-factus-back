import { buildBillPayload } from './factus-payload';
import type { FactusBuildInput } from './factus-types';

const makeInput = (): FactusBuildInput => ({
  referenceCode: 'REF1234567890',
  numberingRangeId: 15,
  customer: {
    documentTypeDian: '13',
    identificationNumber: '800123456',
    dv: '0',
    name: 'Camila Reyes',
    legalOrganizationCode: 2,
    tributeCode: 'ZZ',
    responsibilities: [{ code: 'R-99-PN' }],
    email: 'camila@mail.com',
    municipalityCode: '11001',
    countryCode: 'CO',
  },
  company: {
    legalOrganizationCode: 1,
    name: 'Copigráficas Sierra',
    legalName: 'COPIAGRAFIAS SIERRA S.A.S.',
    tradeName: 'Copigráficas Sierra',
    email: 'copigraficassierra@gmail.com',
    address: 'Carrera 28 # 10 - 70 Local 215',
    registrationCode: 'RC-123',
    phone: '6014557060',
    municipalityCode: '11001',
    economicActivity: '1811',
    tributeCode: '01',
    responsibilities: [{ code: 'O-13' }],
  },
  items: [
    {
      code: 'P001',
      name: 'Fotocopias A4',
      quantity: 10,
      price: 100,
      taxRate: 19,
    },
  ],
  total: 1190,
  paidAmount: 0,
  dueDate: new Date('2026-10-11T00:00:00Z'),
  cashRoundingAmount: 0,
  paymentMethodDian: '10',
  paymentForm: '2',
});

describe('buildBillPayload', () => {
  it('arma el bloque de ítems con taxes del contrato V2', () => {
    const payload = buildBillPayload(makeInput()) as any;
    expect(payload.document).toBe('01');
    expect(payload.operation_type).toBe('10');
    expect(payload.numbering_range_id).toBe(15);
    expect(payload.reference_code).toBe('REF1234567890');
    const item = payload.items[0];
    expect(item.code_reference).toBe('P001');
    expect(item.quantity).toBe(10);
    expect(item.price).toBe(100);
    expect(item.taxes).toEqual([
      { code: '01', rate: '19.00', tax_amount: '190.00' },
    ]);
  });

  it('mapea legal org a persona juridica/natural y responsibilities a códigos', () => {
    const payload = buildBillPayload(makeInput()) as any;
    expect(payload.customer.type).toBe('persona natural');
    expect(payload.customer.legal_organization_code).toBe('2');
    expect(payload.customer.responsibilities).toEqual(['R-99-PN']);
    expect(payload.company.legal_organization_code).toBe('1');
    expect(payload.company.responsibilities).toEqual(['O-13']);
  });

  it('arma payment_details con forma y monto (contrato V2)', () => {
    const payload = buildBillPayload(makeInput()) as any;
    expect(payload.payment_details).toEqual([
      {
        payment_method_code: '10',
        payment_form: '2',
        amount: 0.01,
        due_date: '2026-10-11',
      },
    ]);
  });

  it('payment_form 1 usa el total como monto', () => {
    const input = makeInput();
    input.paymentForm = '1';
    input.paidAmount = 1190;
    const payload = buildBillPayload(input) as any;
    expect(payload.payment_details[0].amount).toBe(1190);
  });
});
