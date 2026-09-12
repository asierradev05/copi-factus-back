import type { FactusBuildInput } from './factus-types';
import { round2 } from './factus-utils';

export function buildBillPayload(
  input: FactusBuildInput,
): Record<string, unknown> {
  const { customer, company } = input;

  const items = input.items.map((item) => {
    const taxAmount = round2(
      item.quantity * item.price * (item.taxRate / 100),
    );
    return {
      code: item.code,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      quantity: item.quantity,
      price: item.price,
      unit_measure_code: item.unitMeasureCode ?? '94',
      standard_code: item.standardCode ?? '999',
      tax: { type: 'IVA', percentage: item.taxRate, tax_amount: taxAmount },
      ...(item.discount && item.discount > 0
        ? { discount: { type: '02', value: round2(item.discount) } }
        : {}),
    };
  });

  const payment_details = [
    {
      payment_method: input.paymentMethodDian,
      payment_form: input.paymentForm,
      amount:
        input.paymentForm === '1'
          ? round2(input.total)
          : round2(input.paidAmount),
      ...(input.dueDate
        ? { payment_due_date: input.dueDate.toISOString().slice(0, 10) }
        : {}),
    },
  ];

  return {
    reference_code: input.referenceCode,
    numbering_range_id: input.numberingRangeId,
    document: '01',
    operation_type: '10',
    cash_rounding_amount: round2(input.cashRoundingAmount ?? 0),
    company: {
      legal_organization_code: company.legalOrganizationCode,
      company: company.legalName,
      trade_name: company.tradeName ?? company.name,
      email: company.email ?? '',
      address: company.address ?? '',
      registration_code: company.registrationCode ?? '',
      phone: company.phone ?? '',
      municipality_code: company.municipalityCode ?? '11001',
      economic_activity: company.economicActivity ?? '',
      tribute_code: company.tributeCode ?? '01',
      responsibilities: company.responsibilities,
    },
    customer: {
      type:
        customer.legalOrganizationCode === 1
          ? 'persona juridica'
          : 'persona natural',
      identification_document_code: customer.documentTypeDian,
      identification_number: customer.identificationNumber,
      ...(customer.dv ? { dv: customer.dv } : {}),
      name: customer.name,
      ...(customer.address ? { address: customer.address } : {}),
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.phone ? { phone: customer.phone } : {}),
      country_code: customer.countryCode ?? 'CO',
      municipality_code: customer.municipalityCode ?? '11001',
      legal_organization_code: customer.legalOrganizationCode,
      tribute_code: customer.tributeCode,
      responsibilities: customer.responsibilities,
    },
    items,
    payment_details,
  };
}