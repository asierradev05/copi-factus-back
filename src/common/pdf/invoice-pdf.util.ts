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
  referenceCode?: string | null;
  factusNumber?: string | null;
  publicUrl?: string | null;
  qrBase64?: string | null;
  paymentForm?: number | null;
  paymentMethods?: string[];
  cashRoundingAmount?: number | null;
  dianErrors?: Array<{ message?: string }>;
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
  logoBase64?: string | null;
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

const PAYMENT_FORM_LABELS: Record<number, string> = {
  1: 'Contado',
  2: 'Crédito',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
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
      table: {
        widths: ['*'],
        body: [
          [
            {
              text: invoice.invoiceNumber
                ? `FACTURA ${invoice.invoiceNumber}`
                : 'FACTURA',
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
    {
      columns: [
        { text: 'Estado', bold: true, fontSize: 9, width: 70 },
        {
          text: STATUS_LABELS[invoice.status] ?? invoice.status,
          fontSize: 9,
        },
      ],
      margin: [0, 0, 0, 2],
    },
    {
      columns: [
        { text: 'Fecha', bold: true, fontSize: 9, width: 70 },
        { text: formatDate(invoice.issueDate), fontSize: 9 },
      ],
      margin: [0, 0, 0, 2],
    },
    {
      columns: [
        { text: 'Vence', bold: true, fontSize: 9, width: 70 },
        { text: formatDate(invoice.dueDate), fontSize: 9 },
      ],
      margin: [0, 0, 0, 2],
    },
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
  const fill = index % 2 === 1 ? '#f0f0f0' : '#ffffff';
  const make = (content: string, alignment: 'left' | 'right' | 'center') => ({
    text: content,
    alignment,
    fontSize: 9,
    fillColor: fill,
  });
  return [
    make(String(index + 1), 'center'),
    make(item.description, 'left'),
    make(`${formatNumber(item.quantity)} und`, 'right'),
    make(formatNumber(item.unitPrice), 'right'),
    make(formatNumber(item.discount), 'right'),
    {
      text: `${formatNumber(item.taxRate)}% · ${formatNumber(item.taxAmount)}`,
      alignment: 'right',
      fontSize: 8,
      fillColor: fill,
    },
    {
      text: formatNumber(item.total),
      alignment: 'right',
      fontSize: 9,
      bold: true,
      color: '#ec1c24',
      fillColor: fill,
    },
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

function totalRow(
  label: string,
  value: number,
  highlight = false,
  fillCream = false,
): Content[] {
  const fill = fillCream ? '#f7e2c2' : '#ffffff';
  return [
    {
      text: label,
      alignment: 'right',
      bold: true,
      fontSize: highlight ? 12 : 11,
      margin: [0, 2, 0, 2],
      color: highlight ? '#ec1c24' : '#222222',
      fillColor: fill,
    },
    {
      text: formatNumber(value),
      alignment: 'right',
      bold: true,
      fontSize: highlight ? 13 : 11,
      margin: [0, 2, 0, 2],
      color: highlight ? '#ec1c24' : '#222222',
      fillColor: fill,
    },
  ];
}

export function buildDocDefinition(
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
    totalRow('TOTAL A PAGAR', invoice.total, true, true),
    currencyRow('Abonado', invoice.paidAmount),
    totalRow('SALDO', invoice.balance, invoice.balance > 0),
  ];

  const content: Content[] = [
    {
      columns: headerColumns,
      columnGap: 10,
      margin: [0, 0, 0, 6],
    },
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
    sectionHeader('INFORMACIÓN DEL CLIENTE'),
    {
      columns: [
        { width: '*', stack: customerLeftStack(invoice) },
        { width: 240, alignment: 'right', stack: customerRightStack(invoice) },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 10],
    },
    sectionHeader('DETALLE DE LA FACTURA'),
    {
      table: {
        headerRows: 1,
        widths: [24, '*', 55, 62, 50, 78, 72],
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
          stack: invoice.notes
            ? ([
                {
                  text: 'OBSERVACIONES',
                  bold: true,
                  fontSize: 9,
                  color: '#2f7ec8',
                },
                { text: invoice.notes, fontSize: 9, margin: [0, 2, 0, 0] },
              ] as Content[])
            : ([] as Content[]),
        },
        {
          width: 220,
          layout: 'noBorders',
          table: { widths: ['*', 95], body: totalsBody },
        },
      ],
      margin: [0, 0, 0, 12],
    },
  ];

  if (
    invoice.factusNumber ||
    invoice.resolutionNumber ||
    invoice.paymentForm ||
    (invoice.paymentMethods?.length ?? 0) > 0 ||
    invoice.cashRoundingAmount
  ) {
    const dianLeft: Content[] = [];
    if (invoice.resolutionNumber) {
      dianLeft.push({
        text: 'RESOLUCIÓN DE FACTURACIÓN',
        bold: true,
        fontSize: 9,
        margin: [0, 0, 0, 2],
      });
      dianLeft.push({
        text: `Número: ${invoice.resolutionNumber}`,
        fontSize: 9,
      });
      dianLeft.push({
        text: `Fecha: ${formatDate(invoice.resolutionDate)}`,
        fontSize: 9,
      });
    }

    if (invoice.factusNumber) {
      dianLeft.push({
        text: 'INFORMACIÓN DIAN',
        bold: true,
        fontSize: 9,
        color: '#2f7ec8',
        margin: [0, 8, 0, 2],
      });
      dianLeft.push({
        text: `Número oficial DIAN: ${invoice.factusNumber}`,
        bold: true,
        fontSize: 9,
      });
      if (invoice.referenceCode) {
        dianLeft.push({
          text: `Referencia: ${invoice.referenceCode}`,
          fontSize: 8,
          color: '#555555',
        });
      }
      if (invoice.publicUrl) {
        dianLeft.push({
          text: invoice.publicUrl,
          fontSize: 7.5,
          color: '#2f7ec8',
          margin: [0, 2, 0, 0],
        });
      }
    }

    const dianRight: Content[] = [];
    if (invoice.cufe) {
      dianRight.push({
        text: 'CUFE',
        bold: true,
        fontSize: 9,
        margin: [0, 0, 0, 2],
      });
      dianRight.push({
        text: invoice.cufe,
        fontSize: 7,
        color: '#333333',
      });
      const dianLabel =
        DIAN_LABELS[invoice.dianStatus] ?? invoice.dianStatus;
      dianRight.push({
        text: `Estado DIAN: ${dianLabel}`,
        fontSize: 9,
        margin: [0, 4, 0, 0],
      });
    }
    if (invoice.qrBase64) {
      dianRight.push({
        image: invoice.qrBase64,
        fit: [76, 76],
        alignment: 'right',
        margin: [0, 6, 0, 0],
      });
      dianRight.push({
        text: 'Comuníquese · Código QR DIAN',
        fontSize: 7,
        color: '#777777',
        alignment: 'right',
      });
    }

    const paymentParts: string[] = [];
    if (invoice.paymentForm) {
      paymentParts.push(
        `Forma de pago: ${
          PAYMENT_FORM_LABELS[invoice.paymentForm] ?? invoice.paymentForm
        }`,
      );
    }
    const methods = (invoice.paymentMethods ?? []).map(
      (m) => PAYMENT_METHOD_LABELS[m] ?? m,
    );
    if (methods.length > 0) {
      paymentParts.push(`Método(s): ${methods.join(', ')}`);
    }
    if (invoice.cashRoundingAmount) {
      paymentParts.push(
        `Redondeo a pesos: ${formatNumber(invoice.cashRoundingAmount)}`,
      );
    }

    const block: Content = {
      columns: [
        { width: '*', stack: dianLeft },
        { width: 'auto', alignment: 'right', stack: dianRight },
      ],
      margin: [0, 0, 0, 6],
    };

    if (paymentParts.length > 0) {
      content.push({
        text: paymentParts.join('  ·  '),
        fontSize: 8.5,
        color: '#555555',
        margin: [0, 2, 0, 6],
      });
    }

    content.push(block);

    if (invoice.dianStatus === 'RECHAZADA' && invoice.dianErrors?.length) {
      content.push(
        ...(invoice.dianErrors.map((e): Content => ({
          text: `DIAN: ${e.message ?? 'Error no especificado.'}`,
          fontSize: 8.5,
          bold: true,
          color: '#ec1c24',
          margin: [0, 1, 0, 1],
        })) as Content[]),
      );
      content.push({ text: '', margin: [0, 0, 0, 8] });
    }
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
      margin: [0, 0, 0, 6],
    },
    {
      columns: [
        {
          text: `${company.name} · ${company.address ?? ''} · Tel: ${company.phone ?? ''} · ${company.email ?? ''}`,
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
      text: 'El soporte legal corresponde al documento electrónico enviado a la DIAN.',
      fontSize: 7.5,
      color: '#777777',
      alignment: 'center',
      margin: [0, 2, 0, 0],
    },
  );

  const document: TDocumentDefinitions = {
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
