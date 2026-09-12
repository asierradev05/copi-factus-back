import * as pdfmakeExports from 'pdfmake';
import type {
  Column,
  Content,
  TCreatedPdf,
  TDocumentDefinitions,
  TFontDictionary,
} from 'pdfmake/interfaces';
import type { CompanyPdfModel } from './invoice-pdf.util';

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

function headerLeftStack(company: CompanyPdfModel): Content[] {
  const stack: Content[] = [
    {
      text: company.legalName || company.name,
      bold: true,
      fontSize: 14,
      margin: [0, 0, 0, 2],
    },
    {
      text: company.name,
      fontSize: 10,
      color: '#555555',
      margin: [0, 0, 0, 2],
    },
  ];
  if (company.taxId) stack.push({ text: `NIT: ${company.taxId}`, fontSize: 9 });
  if (company.address) stack.push({ text: company.address, fontSize: 9 });
  if (company.city) stack.push({ text: company.city, fontSize: 9 });
  if (company.phone) stack.push({ text: `Tel: ${company.phone}`, fontSize: 9 });
  if (company.email) stack.push({ text: company.email, fontSize: 9 });
  return stack;
}

function headerRightStack(quote: QuotePdfModel, status?: string): Content[] {
  const stack: Content[] = [
    {
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: `COTIZACIÓN ${quote.quoteNumber}`,
              bold: true,
              fontSize: 17,
              color: '#ec1c24',
              alignment: 'center',
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 1,
        vLineWidth: () => 1,
        hLineColor: () => '#2f7ec8',
        vLineColor: () => '#2f7ec8',
      },
      margin: [0, 0, 0, 6],
    },
  ];
  if (status) {
    stack.push({
      columns: [
        { text: 'Estado', bold: true, fontSize: 9, width: 70 },
        { text: QUOTE_STATUS_LABELS[status] ?? status, fontSize: 9 },
      ],
      margin: [0, 0, 0, 2],
    });
  }
  stack.push({
    columns: [
      { text: 'Fecha', bold: true, fontSize: 9, width: 70 },
      { text: formatDate(quote.issuedAt), fontSize: 9 },
    ],
    margin: [0, 0, 0, 2],
  });
  stack.push({
    columns: [
      { text: 'Vigencia', bold: true, fontSize: 9, width: 70 },
      { text: formatDate(quote.validUntil), fontSize: 9 },
    ],
    margin: [0, 0, 0, 2],
  });
  return stack;
}

function makeRow(
  a: string,
  b: string,
  c: string,
  d: string,
  e: string,
  header = false,
): Content[] {
  const make = (content: string, alignment: 'left' | 'right') => ({
    text: content,
    alignment,
    fontSize: 9,
    bold: header,
    color: header ? 'white' : undefined,
  });
  return [
    make(a, 'left'),
    make(b, 'right'),
    make(c, 'right'),
    make(d, 'right'),
    make(e, 'right'),
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
      text: `Documento: ${quote.customerDocument}`,
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

  const content: Content[] = [
    { columns: header, margin: [0, 0, 0, 18] },
    { text: 'COTIZACIÓN', bold: true, fontSize: 13, margin: [0, 0, 0, 8] },
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: 515,
          y2: 0,
          lineWidth: 1.2,
          lineColor: '#ec1c24',
        },
      ],
      margin: [0, 0, 0, 14],
    },
    {
      columns: [{ stack: customerStack }],
      margin: [0, 0, 0, 14],
    },
    {
      table: {
        widths: ['*', 40, 80, 55, 75],
        headerRows: 1,
        body: [
          makeRow('Descripción', 'Cant.', 'Valor unitario', 'IVA %', 'Total', true),
          ...quote.lines.map((line) =>
            makeRow(
              line.description,
              String(line.quantity),
              formatNumber(line.unitPrice),
              String(line.taxRate ?? 0),
              formatNumber(line.quantity * line.unitPrice),
            ),
          ),
        ],
      },
      layout: {
        hLineColor: () => '#2f7ec8',
        vLineColor: () => '#2f7ec8',
        fillColor: (rowIndex: number) =>
          rowIndex === 0 ? '#2f7ec8' : rowIndex % 2 === 1 ? '#f7f9fc' : '',
      },
    },
    {
      table: {
        widths: ['*', 90],
        body: [
          [
            { text: 'Subtotal', bold: true, fontSize: 9, fillColor: '#f7e2c2' },
            {
              text: formatNumber(quote.subtotal),
              fontSize: 9,
              bold: true,
              alignment: 'right',
              fillColor: '#f7e2c2',
            },
          ],
          [
            { text: 'IVA', bold: true, fontSize: 9, fillColor: '#f7e2c2' },
            {
              text: formatNumber(quote.taxTotal),
              fontSize: 9,
              bold: true,
              alignment: 'right',
              fillColor: '#f7e2c2',
            },
          ],
          [
            { text: 'TOTAL', bold: true, fontSize: 11, fillColor: '#2f7ec8', color: 'white' },
            {
              text: formatNumber(quote.total),
              bold: true,
              fontSize: 11,
              alignment: 'right',
              fillColor: '#2f7ec8',
              color: 'white',
            },
          ],
        ],
      },
      margin: [0, 10, 0, 8],
    },
    {
      text: 'Nota: los precios están sujetos a disponibilidad y a la vigencia de la presente cotización.',
      fontSize: 8.5,
      italics: true,
      color: '#777777',
      margin: [0, 4, 0, 6],
    },
  ];

  if (quote.notes) {
    content.push({
      text: `Observaciones: ${quote.notes}`,
      fontSize: 9,
      margin: [0, 0, 0, 6],
    });
  }

  content.push({
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
    margin: [0, 10, 0, 6],
  });
  content.push({
    text: `${company.name} · ${company.address ?? ''} · Tel: ${company.phone ?? ''} · ${company.email ?? ''}`,
    fontSize: 8,
    color: '#356ea8',
    alignment: 'center',
    margin: [0, 0, 0, 2],
  });
  content.push({
    text: 'Cotización sin valor legal. Para aceptación, confirme por escrito antes de la fecha de vigencia.',
    fontSize: 7.5,
    color: '#777777',
    alignment: 'center',
    margin: [0, 2, 0, 0],
  });

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
    buildQuoteDocDefinition(quote, company, status),
  );
  return doc.getBuffer();
}