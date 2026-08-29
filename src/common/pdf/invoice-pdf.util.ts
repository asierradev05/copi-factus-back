import * as pdfmakeExports from 'pdfmake';
import type {
  Column,
  Content,
  TCreatedPdf,
  TDocumentDefinitions,
  TFontDictionary,
} from 'pdfmake/interfaces';
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

export interface InvoicePdfLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface InvoicePdfModel {
  invoiceNumber?: string | null;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  status: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidAmount: number;
  balance: number;
  notes?: string | null;
  cufe?: string | null;
  dianStatus: string;
  resolutionNumber?: string | null;
  resolutionDate?: Date | string | null;
  customer: {
    name: string;
    documentType?: string | null;
    documentNumber?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
  };
  items: InvoicePdfLineItem[];
}

export interface CompanyPdfModel {
  name: string;
  legalName: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  logoUrl?: string | null;
}

function formatNumber(value: number): string {
  return Number(value).toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: Date | string | null): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('es-CO');
}

const STATUS_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  EMITIDA: 'Emitida',
  PARCIALMENTE_PAGADA: 'Parcialmente pagada',
  PAGADA: 'Pagada',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
};

const DIAN_LABELS: Record<string, string> = {
  NO_APLICA: 'No aplica',
  PENDIENTE: 'Pendiente',
  ENVIADA: 'Enviada',
  VALIDADA: 'Validada',
  RECHAZADA: 'Rechazada',
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

  if (company.taxId) {
    stack.push({ text: `NIT: ${company.taxId}`, fontSize: 9 });
  }
  if (company.address) {
    stack.push({ text: company.address, fontSize: 9 });
  }
  if (company.city) {
    stack.push({ text: company.city, fontSize: 9 });
  }
  if (company.phone) {
    stack.push({ text: `Tel: ${company.phone}`, fontSize: 9 });
  }
  if (company.email) {
    stack.push({ text: company.email, fontSize: 9 });
  }
  return stack;
}

function headerRightStack(invoice: InvoicePdfModel): Content[] {
  const stack: Content[] = [
    {
      text: invoice.invoiceNumber
        ? `FACTURA ${invoice.invoiceNumber}`
        : 'FACTURA',
      bold: true,
      fontSize: 16,
      margin: [0, 0, 0, 4],
    },
    {
      text: `Estado: ${STATUS_LABELS[invoice.status] ?? invoice.status}`,
      fontSize: 9,
      margin: [0, 0, 0, 2],
    },
    {
      text: `Fecha: ${formatDate(invoice.issueDate)}`,
      fontSize: 9,
      margin: [0, 0, 0, 2],
    },
    { text: `Vence: ${formatDate(invoice.dueDate)}`, fontSize: 9 },
  ];
  return stack;
}

function customerLeftStack(invoice: InvoicePdfModel): Content[] {
  const stack: Content[] = [
    { text: invoice.customer.name, bold: true, fontSize: 10 },
  ];
  if (invoice.customer.documentNumber) {
    stack.push({
      text: `${invoice.customer.documentType ?? 'Documento'}: ${invoice.customer.documentNumber}`,
      fontSize: 9,
    });
  }
  if (invoice.customer.address) {
    stack.push({ text: invoice.customer.address, fontSize: 9 });
  }
  return stack;
}

function customerRightStack(invoice: InvoicePdfModel): Content[] {
  const stack: Content[] = [];
  if (invoice.customer.phone) {
    stack.push({ text: `Tel: ${invoice.customer.phone}`, fontSize: 9 });
  }
  if (invoice.customer.email) {
    stack.push({ text: invoice.customer.email, fontSize: 9 });
  }
  if (invoice.customer.city) {
    stack.push({ text: invoice.customer.city, fontSize: 9 });
  }
  return stack;
}

function itemRow(item: InvoicePdfLineItem, index: number): Content[] {
  return [
    { text: String(index + 1), alignment: 'center', fontSize: 9 },
    { text: item.description, fontSize: 9 },
    { text: formatNumber(item.quantity), alignment: 'right', fontSize: 9 },
    { text: formatNumber(item.unitPrice), alignment: 'right', fontSize: 9 },
    { text: formatNumber(item.discount), alignment: 'right', fontSize: 9 },
    {
      text: `${formatNumber(item.taxRate)}%`,
      alignment: 'right',
      fontSize: 9,
    },
    { text: formatNumber(item.total), alignment: 'right', fontSize: 9 },
  ];
}

function currencyRow(label: string, value: number, bold = false): Content[] {
  return [
    { text: label, alignment: 'right', bold, margin: [0, 1, 0, 1] },
    {
      text: formatNumber(value),
      alignment: 'right',
      bold,
      margin: [0, 1, 0, 1],
    },
  ];
}

function buildDocDefinition(
  invoice: InvoicePdfModel,
  company: CompanyPdfModel,
): TDocumentDefinitions {
  const headerColumns: Column[] = [
    { width: '*', stack: headerLeftStack(company) },
    { width: 240, alignment: 'right', stack: headerRightStack(invoice) },
  ];

  const itemRows: Content[][] = invoice.items.map((item, index) =>
    itemRow(item, index),
  );

  const totalsBody: Content[][] = [
    currencyRow('Subtotal', invoice.subtotal),
    currencyRow('Descuentos', invoice.discountTotal),
    currencyRow('Impuestos', invoice.taxTotal),
    currencyRow('Total a pagar', invoice.total, true),
    currencyRow('Abonado', invoice.paidAmount),
    currencyRow('Saldo', invoice.balance, true),
  ];

  const content: Content[] = [
    {
      columns: headerColumns,
      columnGap: 10,
      margin: [0, 0, 0, 12],
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 }],
      margin: [0, 0, 0, 12],
    },
    {
      text: 'INFORMACIÓN DEL CLIENTE',
      bold: true,
      fontSize: 10,
      margin: [0, 0, 0, 6],
    },
    {
      columns: [
        { width: '*', stack: customerLeftStack(invoice) },
        { width: 240, alignment: 'right', stack: customerRightStack(invoice) },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 12],
    },
    {
      text: 'DETALLE DE LA FACTURA',
      bold: true,
      fontSize: 10,
      margin: [0, 0, 0, 6],
    },
    {
      table: {
        headerRows: 1,
        widths: [28, '*', 70, 70, 65, 55, 80],
        body: [
          [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'Descripción', style: 'tableHeader' },
            { text: 'Cantidad', style: 'tableHeader', alignment: 'right' },
            { text: 'Vlr. unitario', style: 'tableHeader', alignment: 'right' },
            { text: 'Descuento', style: 'tableHeader', alignment: 'right' },
            { text: 'Impuesto', style: 'tableHeader', alignment: 'right' },
            { text: 'Total', style: 'tableHeader', alignment: 'right' },
          ] as Content[],
          ...itemRows,
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 12],
    },
    {
      columns: [
        {
          width: '*',
          stack: invoice.notes
            ? ([
                { text: 'OBSERVACIONES', bold: true, fontSize: 9 },
                { text: invoice.notes, fontSize: 9, margin: [0, 2, 0, 0] },
              ] as Content[])
            : ([] as Content[]),
        },
        {
          width: 220,
          layout: 'noBorders',
          table: { widths: ['*', 90], body: totalsBody },
        },
      ],
      margin: [0, 0, 0, 12],
    },
  ];

  if (invoice.resolutionNumber) {
    const resolutionStack: Content[] = [
      {
        text: 'RESOLUCIÓN DE FACTURACIÓN',
        bold: true,
        fontSize: 9,
        margin: [0, 0, 0, 2],
      },
      { text: `Número: ${invoice.resolutionNumber}`, fontSize: 9 },
      {
        text: `Fecha: ${formatDate(invoice.resolutionDate)}`,
        fontSize: 9,
      },
    ];

    const cufeStack: Content[] = [];
    if (invoice.cufe) {
      cufeStack.push({
        text: 'CUFE',
        bold: true,
        fontSize: 9,
        margin: [0, 0, 0, 2],
      });
      cufeStack.push({
        text: invoice.cufe,
        fontSize: 7,
        color: '#333333',
      });
      cufeStack.push({
        text: `Estado DIAN: ${DIAN_LABELS[invoice.dianStatus] ?? invoice.dianStatus}`,
        fontSize: 9,
        margin: [0, 4, 0, 0],
      });
    }

    content.push({
      columns: [
        { width: '*', stack: resolutionStack },
        { width: 'auto', stack: cufeStack },
      ],
      margin: [0, 0, 0, 12],
    });
  }

  content.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 }],
      margin: [0, 0, 0, 6],
    },
    {
      text:
        'Documento generado por CopiGráfica Sierra. Los valores presentados son informativos; ' +
        'el soporte legal corresponde al documento electrónico enviado a la DIAN.',
      fontSize: 8,
      color: '#777777',
      alignment: 'center',
      margin: [0, 4, 0, 0],
    },
  );

  const document: TDocumentDefinitions = {
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    content,
    styles: {
      tableHeader: {
        bold: true,
        fontSize: 9,
        fillColor: '#EEEEEE',
        color: '#333333',
      },
    },
    pageMargins: [36, 36, 36, 36],
    pageSize: 'LETTER',
  };

  return document;
}

export async function generateInvoicePdf(
  invoice: InvoicePdfModel,
  company: CompanyPdfModel,
): Promise<Buffer> {
  pdfmake.setFonts(DEFAULT_FONTS);
  const doc = pdfmake.createPdf(buildDocDefinition(invoice, company));
  return doc.getBuffer();
}
