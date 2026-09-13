import type { FactusBuildInput, FactusNoteBuildInput } from './factus-types';
import { round2 } from './factus-utils';

const toCodes = (rs: Array<{ code: string }>): string[] =>
  (rs ?? []).map((r) => r.code);

function buildCompanyPayload(company: FactusBuildInput['company']) {
  return {
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
  };
}

function buildCustomerPayload(
  customer: FactusBuildInput['customer'],
  withType = true,
) {
  const base = {
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
  };
  return withType
    ? {
        type:
          customer.legalOrganizationCode === 1
            ? 'persona juridica'
            : 'persona natural',
        ...base,
      }
    : base;
}

function buildItemsPayload(
  items: FactusBuildInput['items'],
  withTaxAmount = true,
) {
  return items.map((item) => {
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
          ...(withTaxAmount ? { tax_amount: taxAmount.toFixed(2) } : {}),
        },
      ],
      ...(item.discount && item.discount > 0
        ? { discount: { type: '02', value: round2(item.discount) } }
        : {}),
    };
  });
}

function buildPaymentDetails(
  paymentMethodDian: string,
  paymentForm: '1' | '2',
  amount: number,
  dueDate?: Date,
) {
  return [
    {
      payment_method_code: paymentMethodDian,
      payment_form: paymentForm,
      amount: round2(amount),
      ...(paymentForm === '2'
        ? {
            due_date: (dueDate ?? new Date(Date.now() + 30 * 86400000))
              .toISOString()
              .slice(0, 10),
          }
        : {}),
    },
  ];
}

export function buildBillPayload(
  input: FactusBuildInput,
): Record<string, unknown> {
  const { customer, company } = input;

  return {
    reference_code: input.referenceCode,
    numbering_range_id: input.numberingRangeId,
    document: '01',
    operation_type: '10',
    cash_rounding_amount: round2(input.cashRoundingAmount ?? 0),
    company: buildCompanyPayload(company),
    customer: buildCustomerPayload(customer),
    items: buildItemsPayload(input.items),
    payment_details: buildPaymentDetails(
      input.paymentMethodDian,
      input.paymentForm,
      input.total,
      input.dueDate,
    ),
  };
}

export function buildNotePayload(
  input: FactusNoteBuildInput,
): Record<string, unknown> {
  const { customer, company } = input;

  return {
    reference_code: input.referenceCode,
    correction_concept_code: input.correctionConceptCode,
    customization_id: input.customizationId,
    bill_number: input.billNumber,
    numbering_range_id: input.numberingRangeId,
    ...(input.observation ? { observation: input.observation } : {}),
    ...(input.cashRoundingAmount
      ? { cash_rounding_amount: round2(input.cashRoundingAmount) }
      : {}),
    company: buildCompanyPayload(company),
    customer: buildCustomerPayload(customer, false),
    items: input.items.map((item) => {
      const taxRate = item.taxRate;
      return {
        code_reference: item.code,
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        quantity: item.quantity,
        discount_rate: (item.discount ?? 0).toFixed(2),
        price: item.price,
        unit_measure_code: item.unitMeasureCode ?? '94',
        standard_code: item.standardCode ?? '999',
        taxes: [{ code: '01', rate: taxRate.toFixed(2) }],
      };
    }),
    payment_details: buildPaymentDetails(
      input.paymentMethodDian,
      input.paymentForm,
      input.amount,
      input.dueDate,
    ),
  };
}
