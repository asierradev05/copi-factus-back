import { Injectable } from '@nestjs/common';
import { DianStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { buildNotePayload, buildBillPayload } from './factus-payload';
import {
  calculateDianDv,
  generateReferenceCode,
  mapDocumentTypeToDian,
  mapPaymentMethodToDian,
} from './factus-utils';
import type {
  FactusBillData,
  FactusBuildInput,
  FactusNoteBuildInput,
  FactusNoteKind,
} from './factus-types';

const BUCKET = 'invoice-pdfs';

@Injectable()
export class FactusEmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  determineDianStatus(data: FactusBillData): DianStatus {
    if (!data.is_validated) return DianStatus.RECHAZADA;
    const hasErrors = Array.isArray(data.errors) && data.errors.length > 0;
    return hasErrors ? DianStatus.ENVIADA : DianStatus.VALIDADA;
  }

  buildPayload(
    invoice: {
      id: string;
      referenceCode?: string | null;
      total: unknown;
      paidAmount: unknown;
      cashRoundingAmount?: unknown;
      dueDate?: Date | null;
      customer?: any;
      items?: any[];
      payments?: any[];
    },
    resolution: { numberingRangeId?: number | null },
    company: {
      legalOrganizationCode?: number | null;
      name: string;
      legalName: string;
      tradeName?: string | null;
      email?: string | null;
      address?: string | null;
      registrationCode?: string | null;
      phone?: string | null;
      municipalityCode?: string | null;
      economicActivity?: string | null;
      tributeCode?: string | null;
      responsibilities?: unknown;
    },
  ): Record<string, unknown> {
    const customer = invoice.customer;
    const countryCode = customer?.countryCode ?? 'CO';
    const legalOrg = customer?.legalOrganizationCode ?? 2;
    const dv =
      customer?.documentType === 'NIT'
        ? (customer?.dv ?? calculateDianDv(customer?.documentNumber ?? ''))
        : (customer?.dv ?? '0');

    const responsibilities: Array<{ code: string }> =
      customer?.responsibilities?.length > 0
        ? customer.responsibilities
        : legalOrg === 2
          ? [{ code: 'R-99-PN' }]
          : [{ code: 'O-13' }];

    const fullyPaid =
      Number(invoice.paidAmount) > 0 &&
      Number(invoice.total) - Number(invoice.paidAmount) <= 0;
    const lastPayment = invoice.payments?.[invoice.payments.length - 1];

    const input: FactusBuildInput = {
      referenceCode: invoice.referenceCode ?? generateReferenceCode(invoice.id),
      numberingRangeId: resolution.numberingRangeId ?? 0,
      customer: {
        documentTypeDian: mapDocumentTypeToDian(customer?.documentType ?? 'CC'),
        dv,
        identificationNumber: String(customer?.documentNumber ?? '').replace(
          /[^0-9]/g,
          '',
        ),
        name: customer?.name ?? 'Cliente',
        legalOrganizationCode: legalOrg,
        tributeCode: customer?.tributeCode ?? (legalOrg === 2 ? 'ZZ' : '01'),
        responsibilities,
        email: customer?.email ?? undefined,
        phone: customer?.phone ?? undefined,
        address: customer?.address ?? undefined,
        municipalityCode: customer?.municipalityCode ?? '11001',
        countryCode,
      },
      company: {
        legalOrganizationCode: company.legalOrganizationCode ?? 1,
        name: company.name,
        legalName: company.legalName,
        tradeName: company.tradeName ?? undefined,
        email: company.email ?? undefined,
        address: company.address ?? undefined,
        registrationCode: company.registrationCode ?? undefined,
        phone: company.phone ?? undefined,
        municipalityCode: company.municipalityCode ?? '11001',
        economicActivity: company.economicActivity ?? undefined,
        tributeCode: company.tributeCode ?? '01',
        responsibilities:
          Array.isArray(company.responsibilities) &&
          (company.responsibilities as Array<{ code: string }>).length > 0
            ? (company.responsibilities as Array<{ code: string }>)
            : [{ code: 'O-13' }],
      },
      items: (invoice.items ?? []).map((it: any, index: number) => ({
        code: it.product?.code ?? `IT${index + 1}`,
        name: String(it.description ?? '').slice(0, 50),
        quantity: Number(it.quantity ?? 0),
        price: Number(it.unitPrice ?? 0),
        taxRate: Number(it.taxRate ?? 0),
        ...(Number(it.discount ?? 0) > 0
          ? { discount: Number(it.discount) }
          : {}),
        unitMeasureCode: it.unitMeasureCode ?? '94',
        standardCode: it.standardCode ?? '999',
      })),
      total: Number(invoice.total ?? 0),
      paidAmount: Number(invoice.paidAmount ?? 0),
      dueDate: invoice.dueDate ?? undefined,
      cashRoundingAmount: Number(invoice.cashRoundingAmount ?? 0),
      paymentMethodDian: mapPaymentMethodToDian(
        lastPayment?.paymentMethod ?? 'EFECTIVO',
      ),
      paymentForm: fullyPaid ? '1' : '2',
    };

    return buildBillPayload(input);
  }

  async archiveDocuments(
    factusNumber: string,
    xml?: string | null,
    pdf?: Buffer | null,
    label = 'factura',
  ): Promise<{ xmlPath: string | null; pdfPath: string | null }> {
    let xmlPath: string | null = null;
    let pdfPath: string | null = null;
    if (xml) {
      const path = `dian/${factusNumber}/${label}.xml`;
      await this.supabase.uploadBuffer(
        BUCKET,
        path,
        Buffer.from(xml, 'utf-8'),
        'application/xml',
      );
      xmlPath = path;
    }
    if (pdf) {
      const path = `dian/${factusNumber}/${label}.pdf`;
      await this.supabase.uploadBuffer(BUCKET, path, pdf, 'application/pdf');
      pdfPath = path;
    }
    return { xmlPath, pdfPath };
  }

  buildNotePayload(
    note: {
      id: string;
      referenceCode?: string | null;
      total: unknown;
      paidAmount: unknown;
      cashRoundingAmount?: unknown;
      dueDate?: Date | null;
      customer?: any;
      items?: any[];
      payments?: any[];
      billNumber?: string | null;
      correctionConceptCode?: string | null;
      operationType?: string | null;
      notes?: string | null;
    },
    resolution: { numberingRangeId?: number | null },
    company: {
      legalOrganizationCode?: number | null;
      name: string;
      legalName: string;
      tradeName?: string | null;
      email?: string | null;
      address?: string | null;
      registrationCode?: string | null;
      phone?: string | null;
      municipalityCode?: string | null;
      economicActivity?: string | null;
      tributeCode?: string | null;
      responsibilities?: unknown;
    },
    kind: FactusNoteKind,
  ): Record<string, unknown> {
    const customer = note.customer;
    const countryCode = customer?.countryCode ?? 'CO';
    const legalOrg = customer?.legalOrganizationCode ?? 2;
    const dv =
      customer?.documentType === 'NIT'
        ? (customer?.dv ?? calculateDianDv(customer?.documentNumber ?? ''))
        : (customer?.dv ?? '0');

    const responsibilities: Array<{ code: string }> =
      customer?.responsibilities?.length > 0
        ? customer.responsibilities
        : legalOrg === 2
          ? [{ code: 'R-99-PN' }]
          : [{ code: 'O-13' }];

    const lastPayment = note.payments?.[note.payments.length - 1];
    const amount = Number(note.total ?? 0);

    const input: FactusNoteBuildInput = {
      referenceCode: note.referenceCode ?? generateReferenceCode(note.id),
      numberingRangeId: resolution.numberingRangeId ?? 0,
      billNumber: note.billNumber ?? '',
      correctionConceptCode: note.correctionConceptCode ?? '1',
      customizationId:
        note.operationType ?? (kind === 'NOTA_CREDITO' ? '20' : '30'),
      observation: note.notes ?? undefined,
      customer: {
        documentTypeDian: mapDocumentTypeToDian(customer?.documentType ?? 'CC'),
        dv,
        identificationNumber: String(customer?.documentNumber ?? '').replace(
          /[^0-9]/g,
          '',
        ),
        name: customer?.name ?? 'Cliente',
        legalOrganizationCode: legalOrg,
        tributeCode: customer?.tributeCode ?? (legalOrg === 2 ? 'ZZ' : '01'),
        responsibilities,
        email: customer?.email ?? undefined,
        phone: customer?.phone ?? undefined,
        address: customer?.address ?? undefined,
        municipalityCode: customer?.municipalityCode ?? '11001',
        countryCode,
      },
      company: {
        legalOrganizationCode: company.legalOrganizationCode ?? 1,
        name: company.name,
        legalName: company.legalName,
        tradeName: company.tradeName ?? undefined,
        email: company.email ?? undefined,
        address: company.address ?? undefined,
        registrationCode: company.registrationCode ?? undefined,
        phone: company.phone ?? undefined,
        municipalityCode: company.municipalityCode ?? '11001',
        economicActivity: company.economicActivity ?? undefined,
        tributeCode: company.tributeCode ?? '01',
        responsibilities:
          Array.isArray(company.responsibilities) &&
          (company.responsibilities as Array<{ code: string }>).length > 0
            ? (company.responsibilities as Array<{ code: string }>)
            : [{ code: 'O-13' }],
      },
      items: (note.items ?? []).map((it: any, index: number) => ({
        code: it.product?.code ?? `IT${index + 1}`,
        name: String(it.description ?? '').slice(0, 50),
        quantity: Number(it.quantity ?? 0),
        price: Number(it.unitPrice ?? 0),
        taxRate: Number(it.taxRate ?? 0),
        ...(Number(it.discount ?? 0) > 0
          ? { discount: Number(it.discount) }
          : {}),
        unitMeasureCode: it.unitMeasureCode ?? '94',
        standardCode: it.standardCode ?? '999',
      })),
      amount,
      dueDate: note.dueDate ?? undefined,
      paymentMethodDian: mapPaymentMethodToDian(
        lastPayment?.paymentMethod ?? 'EFECTIVO',
      ),
      paymentForm: '1',
    };

    return buildNotePayload(input);
  }
}
