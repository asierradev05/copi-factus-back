export interface FactusError {
  status_code: number;
  error?: Array<{ context?: string; error_type?: string; message?: string }>;
  message?: string;
}

export interface FactusBillData {
  number: string;
  document: string;
  cufe: string;
  is_validated: boolean;
  errors?: Array<{ context?: string; error_type?: string; message?: string }>;
  validated_at?: string | null;
  type_document?: string;
  totals?: {
    gross_total?: number;
    tax_total?: number;
    taxable_total?: number;
    total?: number;
  };
  currency_code?: string;
  links?: {
    url_qr_code?: string;
    url_public?: string;
    url_graphic_representation?: string;
  };
}

export interface FactusBillResponse {
  data: FactusBillData;
}

export interface FactusRangeResponse {
  id?: number;
  data?: { id?: number };
}

export interface FactusBuildItem {
  code: string;
  name: string;
  description?: string;
  quantity: number;
  price: number;
  taxRate: number;
  discount?: number;
  unitMeasureCode?: string;
  standardCode?: string;
}

export interface FactusBuildCustomer {
  documentTypeDian: string;
  dv?: string;
  identificationNumber: string;
  name: string;
  legalOrganizationCode: number;
  tributeCode: string;
  responsibilities: Array<{ code: string }>;
  email?: string;
  phone?: string;
  address?: string;
  municipalityCode?: string;
  countryCode?: string;
}

export interface FactusBuildCompany {
  legalOrganizationCode: number;
  name: string;
  legalName: string;
  tradeName?: string;
  email?: string;
  address?: string;
  registrationCode?: string;
  phone?: string;
  municipalityCode?: string;
  economicActivity?: string;
  tributeCode?: string;
  responsibilities: Array<{ code: string }>;
}

export interface FactusBuildInput {
  referenceCode: string;
  numberingRangeId: number;
  customer: FactusBuildCustomer;
  company: FactusBuildCompany;
  items: FactusBuildItem[];
  total: number;
  paidAmount: number;
  dueDate?: Date;
  cashRoundingAmount?: number;
  paymentMethodDian: string;
  paymentForm: '1' | '2';
}

export type FactusNoteKind = 'NOTA_CREDITO' | 'NOTA_DEBITO';

export interface FactusNoteBuildInput {
  referenceCode: string;
  numberingRangeId: number;
  billNumber: string;
  correctionConceptCode: string;
  customizationId: string;
  observation?: string;
  cashRoundingAmount?: number;
  customer: FactusBuildCustomer;
  company: FactusBuildCompany;
  items: FactusBuildItem[];
  amount: number;
  dueDate?: Date;
  paymentMethodDian: string;
  paymentForm: '1' | '2';
}

export interface FactusStatus {
  configured: boolean;
  ambient: string;
  emisorSynced: boolean;
  url: string | null;
}
