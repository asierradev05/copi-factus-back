import type { FactusBuildInput } from './factus-types';
import { round2 } from './factus-utils';

const toCodes = (rs: Array<{ code: string }>): string[] =>
  (rs ?? []).map((r) => r.code);

export function buildBillPayload(
  input: FactusBuildInput,
): Record<string, unknown> {
  const { customer, company } = input;

  const items = input.items.map((item) => {
    const taxAmount = round2(item.quantity * item.price * (item.taxRate / 100));
    return {
      code_reference: item.code,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      quantity: item.quantity,
      price: item.price,
      unit_measure_code: item.unitMeasureCode ?? '94',
      standard_code: item.standardCode ?? '999',
      taxes: [
        {
          code: '01',
          rate: item.taxRate.toFixed(2),
          tax_amount: taxAmount.toFixed(2),
        },
      ],
      ...(item.discount && item.discount > 0
        ? { discount: { type: '02', value: round2(item.discount) } }
        : {}),
    };
  });

  const payment_details = [
    {
      payment_method_code: input.paymentMethodDian,
      payment_form: input.paymentForm,
      amount: round2(input.total),
      ...(input.paymentForm === '2'
        ? {
            due_date: (input.dueDate ?? new Date(Date.now() + 30 * 86400000))
              .toISOString()
              .slice(0, 10),
          }
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
      legal_organization_code: String(company.legalOrganizationCode ?? 1),
      company: company.legalName,
      trade_name: company.tradeName ?? company.name,
      email: company.email ?? '',
      address: company.address ?? '',
      registration_code: company.registrationCode ?? '',
      phone: company.phone ?? '',
      municipality_code: company.municipalityCode ?? '11001',
      economic_activity: company.economicActivity ?? '',
      tribute_code: company.tributeCode ?? '01',
      responsibilities: toCodes(company.responsibilities),
    },
    customer: {
      type:
        customer.legalOrganizationCode === 1
          ? 'persona juridica'
          : 'persona natural',
      identification_document_code: customer.documentTypeDian,
      identification: customer.identificationNumber,
      ...(customer.dv ? { dv: customer.dv } : {}),
      names: customer.name,
      ...(customer.address ? { address: customer.address } : {}),
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.phone ? { phone: customer.phone } : {}),
      country_code: customer.countryCode ?? 'CO',
      municipality_code: customer.municipalityCode ?? '11001',
      legal_organization_code: String(customer.legalOrganizationCode),
      tribute_code: customer.tributeCode,
      responsibilities: toCodes(customer.responsibilities),
    },
    items,
    payment_details,
  };
}