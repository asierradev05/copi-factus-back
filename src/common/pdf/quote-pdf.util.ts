import * as pdfmakeExports from 'pdfmake';
import type {
  Column,
  Content,
  TCreatedPdf,
  TDocumentDefinitions,
  TFontDictionary,
} from 'pdfmake/interfaces';
import type { CompanyPdfModel } from './invoice-pdf.util';
import { getBrandLogoBase64, BRAND } from './brand-assets.util';

interface PdfmakePrinter {
  setFonts(fonts: TFontDictionary): void;
  createPdf(document: TDocumentDefinitions): TCreatedPdf;
}

const pdfmake = (
  pdfmakeExports as unknown as {
    default: PdfmakePrinter;
  }
).default;

const DEFAULT_FONTS: TFontDictionary = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

export interface QuotePdfLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export interface QuotePdfModel {
  quoteNumber: string;
  issuedAt?: Date | string | null;
  validUntil?: Date | string | null;
  customerName?: string | null;
  customerDocument?: string | null;
  address?: string | null;
  lines: QuotePdfLineItem[];
  subtotal: number | null;
  taxTotal: number | null;
  total: number | null;
  notes?: string | null;
}

function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: Date | string | null): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('es-CO');
}

const QUOTE_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  FACTURADA: 'Facturada',
};

function statusColor(status: string): string {
  if (status === 'APROBADA') return '#1a7f37';
  if (status === 'RECHAZADA') return '#ec1c24';
  return '#356ea8';
}

function headerLeftStack(company: CompanyPdfModel): Content[] {
  const stack: Content[] = [
    {
      text: company.legalName || company.name,
      bold: true,
      fontSize: 12,
      color: '#356ea8',
      margin: [0, 0, 0, 1],
    },
  ];

  if (company.taxId) {
    stack.push({
      text: `NIT ${company.taxId}`,
      fontSize: 9,
      color: '#555555',
      margin: [0, 0, 0, 3],
    });
  }
  stack.push({ text: BRAND.address, fontSize: 9, color: '#356ea8' });
  stack.push({ text: BRAND.phone, fontSize: 9, color: '#ec1c24' });
  stack.push({
    text: `${BRAND.email} - ${BRAND.website}`,
    fontSize: 9,
    bold: true,
    color: '#2f7ec8',
    margin: [0, 2, 0, 0],
  });
  return stack;
}

function headerRightStack(quote: QuotePdfModel, status?: string): Content[] {
  const boxCell = (
    text: string,
    alignment: 'left' | 'right' | 'center' = 'left',
  ) => ({ text, alignment, fontSize: 9 });

  const rows: Content[][] = [
    [
      { text: 'FECHA', bold: true, fontSize: 8 },
      boxCell(formatDate(quote.issuedAt), 'right'),
    ],
    [
      { text: 'No. COTIZACIÓN', bold: true, fontSize: 8 },
      {
        text: quote.quoteNumber,
        alignment: 'right',
        bold: true,
        fontSize: 10,
        color: '#ec1c24',
      },
    ],
    [
      { text: 'VÁLIDO HASTA', bold: true, fontSize: 8 },
      boxCell(formatDate(quote.validUntil), 'right'),
    ],
  ];

  if (status) {
    rows.push([
      { text: 'ESTADO', bold: true, fontSize: 8 },
      {
        text: QUOTE_STATUS_LABELS[status] ?? status,
        alignment: 'right',
        bold: true,
        fontSize: 9,
        color: statusColor(status),
      },
    ]);
  }

  return [
    {
      table: {
        widths: [72, '*'],
        body: [
          [
            {
              text: `COTIZACIÓN ${quote.quoteNumber}`,
              colSpan: 2,
              bold: true,
              fontSize: 16,
              alignment: 'center',
              color: '#ec1c24',
              fillColor: '#f7e2c2',
            },
            {},
          ],
          ...rows,
        ],
      },
      layout: {
        hLineColor: () => '#222222',
        vLineColor: () => '#222222',
        hLineWidth: () => 0.8,
        vLineWidth: () => 0.8,
      },
    },
  ];
}

function sectionHeader(text: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            text: text.toUpperCase(),
            bold: true,
            fontSize: 10,
            color: 'white',
            alignment: 'left',
            margin: [4, 3, 4, 3],
            fillColor: '#2f7ec8',
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8],
  };
}

function itemRow(line: QuotePdfLineItem, index: number): Content[] {
  const fill = index % 2 === 1 ? '#f0f0f0' : '#ffffff';
  const make = (
    content: string,
    alignment: 'left' | 'right' | 'center',
  ): Content => ({
    text: content,
    alignment,
    fontSize: 9,
    fillColor: fill,
  });
  return [
    make(String(index + 1), 'center'),
    make(line.description, 'left'),
    make(formatNumber(line.quantity), 'right'),
    make(formatNumber(line.unitPrice), 'right'),
    make(`${formatNumber(line.taxRate ?? 0)}%`, 'right'),
    {
      text: formatNumber(line.quantity * line.unitPrice),
      alignment: 'right',
      fontSize: 9,
      bold: true,
      color: '#ec1c24',
      fillColor: fill,
    },
  ];
}

function totalRow(
  label: string,
  value: number | null | undefined,
  highlight = false,
): Content[] {
  const fill = highlight ? '#f7e2c2' : '#ffffff';
  return [
    {
      text: label,
      alignment: 'right',
      bold: true,
      fontSize: highlight ? 12 : 10,
      margin: [0, 2, 0, 2],
      color: highlight ? '#ec1c24' : '#222222',
      fillColor: fill,
    },
    {
      text: formatNumber(value),
      alignment: 'right',
      bold: true,
      fontSize: highlight ? 13 : 10,
      margin: [0, 2, 0, 2],
      color: highlight ? '#ec1c24' : '#222222',
      fillColor: fill,
    },
  ];
}

export function buildQuoteDocDefinition(
  quote: QuotePdfModel,
  company: CompanyPdfModel,
  status?: string,
): TDocumentDefinitions {
  const header: Column[] = [
    { width: '*', stack: headerLeftStack(company) },
    { width: 240, alignment: 'right', stack: headerRightStack(quote, status) },
  ];

  const customerStack: Content[] = [
    { text: quote.customerName ?? '-', bold: true, fontSize: 10 },
  ];
  if (quote.customerDocument) {
    customerStack.push({
      text: `NIT/Documento: ${quote.customerDocument}`,
      fontSize: 9,
      margin: [0, 2, 0, 0],
    });
  }
  if (quote.address) {
    customerStack.push({
      text: quote.address,
      fontSize: 9,
      margin: [0, 2, 0, 0],
    });
  }

  const totalsBody = [
    totalRow('Subtotal', quote.subtotal),
    totalRow('IVA', quote.taxTotal),
    totalRow('TOTAL', quote.total, true),
  ];

  const content: Content[] = [];

  if (company.logoBase64) {
    content.push({
      image: company.logoBase64,
      fit: [170, 48],
      alignment: 'center',
      margin: [0, 0, 0, 8],
    });
  }

  content.push(
    { columns: header, columnGap: 10, margin: [0, 0, 0, 4] },
    {
      text: 'SOMOS UNA EMPRESA DIRECTA (SIN INTERMEDIARIOS)',
      fontSize: 8,
      bold: true,
      color: '#356ea8',
      alignment: 'center',
      margin: [0, 0, 0, 8],
    },
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: 515,
          y2: 0,
          lineWidth: 1.2,
          lineColor: '#2f7ec8',
        },
      ],
      margin: [0, 0, 0, 10],
    },
    sectionHeader('CLIENTE'),
    {
      columns: [{ stack: customerStack }],
      margin: [0, 0, 0, 10],
    },
    sectionHeader('DETALLE DE LA COTIZACIÓN'),
    {
      table: {
        widths: [24, '*', 55, 62, 50, 78],
        headerRows: 1,
        body: [
          [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'Descripción', style: 'tableHeader' },
            { text: 'Cantidad', style: 'tableHeader', alignment: 'right' },
            { text: 'Valor unit.', style: 'tableHeader', alignment: 'right' },
            { text: 'IVA %', style: 'tableHeader', alignment: 'right' },
            { text: 'Total', style: 'tableHeader', alignment: 'right' },
          ] as Content[],
          ...quote.lines.map((line, index) => itemRow(line, index)),
        ],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#d1d1d1',
        vLineColor: () => '#d1d1d1',
      },
      margin: [0, 0, 0, 10],
    },
    {
      columns: [
        {
          width: '*',
          stack: [
            {
              text: 'TÉRMINOS Y CONDICIONES',
              bold: true,
              fontSize: 9,
              color: '#2f7ec8',
              margin: [0, 0, 0, 2],
            },
            {
              text: 'Los precios están sujetos a disponibilidad y a la vigencia de la presente cotización. Para aceptación, confirme por escrito antes de la fecha de vencimiento.',
              fontSize: 8.5,
              margin: [0, 2, 0, 0],
            },
          ] as Content[],
        },
        {
          width: 220,
          layout: 'noBorders',
          table: { widths: ['*', 95], body: totalsBody },
        },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 12],
    },
  );

  if (quote.notes) {
    content.push({
      text: `Observaciones: ${quote.notes}`,
      fontSize: 9,
      margin: [0, 0, 0, 10],
    });
  }

  content.push(
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: 515,
          y2: 0,
          lineWidth: 1.2,
          lineColor: '#2f7ec8',
        },
      ],
      margin: [0, 4, 0, 6],
    },
    {
      columns: [
        {
          text: `${company.name || BRAND.name} · ${BRAND.address} · ${BRAND.phone} · ${BRAND.email} · ${BRAND.website}`,
          fontSize: 8,
          color: '#356ea8',
          alignment: 'center',
        },
      ],
      margin: [0, 4, 0, 2],
    },
    {
      text: 'SOMOS UNA EMPRESA DIRECTA (SIN INTERMEDIARIOS)',
      fontSize: 8,
      bold: true,
      color: '#ec1c24',
      alignment: 'center',
      margin: [0, 0, 0, 2],
    },
    {
      text: BRAND.bank,
      fontSize: 8.5,
      italics: true,
      color: '#222222',
      alignment: 'center',
      margin: [0, 4, 0, 0],
    },
  );

  return {
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#222222' },
    content,
    styles: {
      tableHeader: {
        bold: true,
        fontSize: 9,
        fillColor: '#2f7ec8',
        color: 'white',
      },
    },
    pageMargins: [36, 36, 36, 36],
    pageSize: 'LETTER',
  };
}

export async function generateQuotePdf(
  quote: QuotePdfModel,
  company: CompanyPdfModel,
  status?: string,
): Promise<Buffer> {
  pdfmake.setFonts(DEFAULT_FONTS);
  const doc = pdfmake.createPdf(
    buildQuoteDocDefinition(
      quote,
      {
        ...company,
        logoBase64: company.logoBase64 ?? (await getBrandLogoBase64()),
      },
      status,
    ),
  );
  return doc.getBuffer();
}
