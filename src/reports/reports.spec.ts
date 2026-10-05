import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  DianStatus,
  DocumentType,
  InvoiceKind,
  InvoiceStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AccountsReceivableModule } from '../accounts-receivable/accounts-receivable.module';
import { CustomersService } from '../customers/customers.service';
import { ReportsService } from './reports.service';

/**
 * Cubre el filtro de documentos rechazados por la DIAN contra Prisma. La
 * unit de `summarizeSales` demuestra la aritmetica, pero no que la consulta
 * deje fuera un documento rechazado: ese filtro vive en el `where`.
 */
describe('Reports DIAN status (integracion)', () => {
  let prisma: PrismaService;
  let reportsService: ReportsService;
  let customerId: string;

  const suffix = Date.now().toString();
  const created: string[] = [];

  /**
   * Inserta una factura directamente. Un documento rechazado por la DIAN queda
   * en BORRADOR, asi que para poder aislar el filtro de `dianStatus` se fuerza
   * un estado interno no borrador: si el filtro desapareciera, la factura
   * reapareceria en el reporte y la prueba lo detectaria.
   */
  const seedInvoice = async (opts: {
    dianStatus: DianStatus;
    total: number;
    documentKind?: InvoiceKind;
  }) => {
    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        status: InvoiceStatus.EMITIDA,
        dianStatus: opts.dianStatus,
        documentKind: opts.documentKind ?? InvoiceKind.FACTURA,
        ambient: 'HABILITACION',
        issueDate: new Date(),
        subtotal: opts.total,
        taxTotal: 0,
        discountTotal: 0,
        total: opts.total,
        paidAmount: 0,
        balance: opts.total,
        resolutionId: null,
        items: {
          create: [
            {
              description: `[TEST] linea ${opts.dianStatus}`,
              quantity: 1,
              unitPrice: opts.total,
              discount: 0,
              taxRate: 0,
              subtotal: opts.total,
              taxAmount: 0,
              total: opts.total,
            },
          ],
        },
      },
    });
    created.push(invoice.id);
    return invoice;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        AccountsReceivableModule,
      ],
      providers: [CustomersService, ReportsService],
    }).compile();

    prisma = module.get(PrismaService);
    reportsService = module.get(ReportsService);

    const customer = await prisma.customer.create({
      data: {
        name: `Cliente Reportes ${suffix}`,
        documentType: DocumentType.CC,
        documentNumber: `RP-${suffix}`,
        phone: `300-RP-${suffix}`,
        email: `cliente-rp-${suffix}@test.com`,
      },
    });
    customerId = customer.id;
  }, 120000);

  afterAll(async () => {
    await prisma.invoiceItem.deleteMany({
      where: { invoiceId: { in: created } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: created } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
  }, 120000);

  it('excluye del reporte de ventas una factura rechazada por la DIAN', async () => {
    const accepted = await seedInvoice({
      dianStatus: DianStatus.VALIDADA,
      total: 100000,
    });
    const rejected = await seedInvoice({
      dianStatus: DianStatus.RECHAZADA,
      total: 500000,
    });

    // Se verifica contra la BD y no contra el resultado: si el filtro no
    // existiera, la factura rechazada entraria por estar en EMITIDA.
    const enBd = await prisma.invoice.findUniqueOrThrow({
      where: { id: rejected.id },
    });
    expect(enBd.status).toBe(InvoiceStatus.EMITIDA);
    expect(enBd.dianStatus).toBe(DianStatus.RECHAZADA);

    // Y el par positivo tiene que estar VALIDADA de verdad: si el enum no
    // existiera, `DianStatus.X` seria undefined y Prisma aplicaria el default,
    // y la prueba pasaria sin comprobar nada.
    const enBdAceptada = await prisma.invoice.findUniqueOrThrow({
      where: { id: accepted.id },
    });
    expect(enBdAceptada.dianStatus).toBe(DianStatus.VALIDADA);

    const report = await reportsService.getSalesReport({});

    // La base es compartida, asi que el aserto es sobre estos documentos y no
    // sobre totales globales.
    const ids = report.invoices.map((i) => i.id);
    expect(ids).toContain(accepted.id);
    expect(ids).not.toContain(rejected.id);

    // Y el rechazado no aporta a las ventas.
    const acceptedRow = report.invoices.find((i) => i.id === accepted.id);
    expect(Number(acceptedRow!.total)).toBe(100000);
  }, 120000);

  it('un documento rechazado tampoco suma a las ventas netas', async () => {
    // El filtro del `where` y el de la agregacion tienen que ir juntos: si la
    // consulta lo excluye pero el total lo sumara, el reporte no cuadraria.
    const report = await reportsService.getSalesReport({});

    const enDetalle = report.invoices.reduce(
      (acc, i) => acc + Number(i.total),
      0,
    );
    expect(Number(report.invoiceTotal)).toBe(enDetalle);
    expect(Number(report.netSales)).toBe(enDetalle);
  }, 120000);

  it('las notas rechazadas tampoco entran al reporte', async () => {
    const note = await seedInvoice({
      dianStatus: DianStatus.RECHAZADA,
      total: 300000,
      documentKind: InvoiceKind.NOTA_CREDITO,
    });
    const acceptedNote = await seedInvoice({
      dianStatus: DianStatus.VALIDADA,
      total: 50000,
      documentKind: InvoiceKind.NOTA_CREDITO,
    });

    const report = await reportsService.getSalesReport({});
    const ids = report.invoices.map((i) => i.id);

    expect(ids).toContain(acceptedNote.id);
    expect(ids).not.toContain(note.id);

    // El total de NC solo puede venir de la nota aceptada.
    const detailNotes = report.invoices
      .filter((i) => i.id === acceptedNote.id || i.id === note.id)
      .reduce((acc, i) => acc + Number(i.total), 0);
    expect(Number(report.creditNotesTotal)).toBe(detailNotes);
    expect(Number(report.creditNotesTotal)).toBe(50000);
  }, 120000);
});
