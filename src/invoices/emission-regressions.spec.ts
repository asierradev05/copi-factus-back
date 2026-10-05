import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AuditAction,
  DianStatus,
  DocumentType,
  InvoiceKind,
  InvoiceStatus,
  UserRole,
} from '@prisma/client';
import type { Invoice } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { EmailModule } from '../common/email/email.module';
import { SupabaseModule } from '../common/supabase/supabase.module';
import { FactusModule } from '../factus/factus.module';
import { FactusAdapterService } from '../factus/factus-adapter.service';
import { FactusAuthService } from '../factus/factus-auth.service';
import { FactusEmissionService } from '../factus/factus-emission.service';
import { CustomersService } from '../customers/customers.service';
import { InvoicesService } from '../invoices/invoices.service';

/**
 * Regresiones de dinero alrededor de la emision electronica. Usa la base de
 * datos real (los calculos de Decimal no se pueden fakesar con fiabilidad) pero
 * sustituye el adaptador de Factus para poder reproducir respuestas que en
 * sandbox no se provocan a voluntad, sobre todo `is_validated: false`.
 *
 * Invariantes que fija:
 *  - un documento RECHAZADO no altera el saldo de la factura origen;
 *  - un documento RECHAZADO no consume saldo a favor del cliente;
 *  - el payload enviado a la DIAN declara el mismo paidAmount que el ledger;
 *  - dos emisiones concurrentes no pueden gastar el mismo credito dos veces.
 */
describe('Emission financial regressions', () => {
  let prisma: PrismaService;
  let customersService: CustomersService;
  let invoicesService: InvoicesService;
  let factusAdapter: { [k: string]: jest.Mock };
  let factusAuth: { isConfigured: jest.Mock };

  let actorId: string;
  let customerId: string;
  const customerIds: string[] = [];
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const created: string[] = [];

  /** Respuesta de Factus que se puede ajustar por test. */
  const dianResponse = {
    isValidated: true as boolean,
    cufe: 'CUFE-TEST-0001',
    cude: 'CUDE-TEST-0001',
    errors: [] as string[],
  };

  // `invoice_number` es unico en la base, asi que cada emision del test necesita
  // un numero distinto, como haria Factus.
  let billSeq = 0;
  let noteSeq = 0;
  const nextBillNumber = () => `SETP-TEST-${++billSeq}`;
  const nextNoteNumber = () => `NC-TEST-${String(++noteSeq).padStart(4, '0')}`;

  const resetDian = () => {
    dianResponse.isValidated = true;
    dianResponse.errors = [];
  };

  const draft = async (unitPrice: number, customerIdOverride?: string) => {
    const invoice = (await invoicesService.createDraft(
      {
        customerId: customerIdOverride ?? customerId,
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        items: [
          {
            description: `[TEST REGR] linea`,
            quantity: 1,
            unitPrice,
            discount: 0,
            taxRate: 19,
          },
        ],
      } as any,
      actorId,
    )) as Invoice;
    created.push(invoice.id);
    return invoice;
  };

  beforeAll(async () => {
    factusAdapter = {
      validateBills: jest.fn(async () => ({
        data: {
          number: nextBillNumber(),
          cufe: dianResponse.cufe,
          is_validated: dianResponse.isValidated,
          errors: dianResponse.errors,
          validated_at: new Date().toISOString(),
          links: {
            qr: 'https://example.test/qr',
            public_url: 'https://example.test/pub',
          },
        },
      })),
      validateNoteCredit: jest.fn(async () => ({
        data: {
          number: nextNoteNumber(),
          cude: dianResponse.cude,
          bill: { cufe: dianResponse.cufe },
          is_validated: dianResponse.isValidated,
          errors: dianResponse.errors,
          totals: { total: 100000 },
          validated_at: new Date().toISOString(),
          links: { qr: 'https://example.test/qr-note' },
        },
      })),
      validateNoteDebit: jest.fn(async () => ({
        data: {
          number: nextNoteNumber(),
          cude: dianResponse.cude,
          is_validated: dianResponse.isValidated,
          errors: dianResponse.errors,
          validated_at: new Date().toISOString(),
          links: {},
        },
      })),
      downloadBillXml: jest.fn(async () => null),
      downloadBillPdf: jest.fn(async () => null),
      downloadNoteXml: jest.fn(async () => null),
      downloadNotePdf: jest.fn(async () => null),
    };
    factusAuth = { isConfigured: jest.fn(() => true) };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        EmailModule,
        SupabaseModule,
        FactusModule,
      ],
      providers: [CustomersService, InvoicesService],
    })
      .overrideProvider(FactusAdapterService)
      .useValue(factusAdapter)
      .overrideProvider(FactusAuthService)
      .useValue(factusAuth)
      .compile();

    prisma = module.get(PrismaService);
    customersService = module.get(CustomersService);
    invoicesService = module.get(InvoicesService);
    module.get(AuditService);

    // archiveDocuments intentaria subir a Supabase; aqui no interesa.
    jest
      .spyOn(FactusEmissionService.prototype, 'archiveDocuments')
      .mockResolvedValue({ xmlPath: null, pdfPath: null } as any);

    const actor = await prisma.profile.create({
      data: {
        email: `test-regr-${suffix}@copigrafica.dev`,
        fullName: 'Test Regression',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;
  }, 180000);

  /** Cliente dedicado al test en curso: el credito a favor es por cliente, asi
   * que compartirlo haria que un caso consuma el saldo que otro necesita. */
  const newCustomer = async () => {
    const customer = await customersService.create(
      {
        name: `Regr ${suffix}-${customerIds.length}`,
        documentType: DocumentType.CC,
        documentNumber: `REGR-${suffix}-${customerIds.length}`,
        phone: `3${String(customerIds.length).padStart(2, '0')}${suffix.slice(-7)}`,
        email: `regr-${suffix}-${customerIds.length}@test.com`,
      } as any,
      actorId,
    );
    const id = (customer as any).id as string;
    customerIds.push(id);
    return id;
  };

  const savedFallback = process.env.ALLOW_IN_MEMORY_FALLBACK;

  beforeEach(async () => {
    resetDian();
    jest.clearAllMocks();
    customerId = await newCustomer();
    // Sin este flag, `useInMemoryFallback()` devuelve true en test y un error
    // no-HTTP de `emitViaFactus` cae silenciosamente a `emitLocal`, que devuelve
    // una factura EMITIDA sin estado DIAN y esconde la causa real.
    process.env.ALLOW_IN_MEMORY_FALLBACK = 'false';
  }, 60000);

  afterAll(async () => {
    if (savedFallback === undefined) {
      delete process.env.ALLOW_IN_MEMORY_FALLBACK;
    } else {
      process.env.ALLOW_IN_MEMORY_FALLBACK = savedFallback;
    }
    for (const id of created) {
      await prisma.payment.deleteMany({ where: { invoiceId: id } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } });
    }
    await prisma.invoice.deleteMany({ where: { id: { in: created } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.profile.deleteMany({
      where: { email: `test-regr-${suffix}@copigrafica.dev` },
    });
    // Sin esto, cada corrida deja rastros de auditoria huerfanos en la base
    // compartida.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: actorId },
          { entityType: 'Invoice', entityId: { in: created } },
        ],
      },
    });
    await prisma.$disconnect();
    // La limpieza encadena varios borrados contra una base remota; el default
    // de 5s para hooks de Jest no alcanza.
  }, 180000);

  const fresh = (id: string) =>
    prisma.invoice.findUniqueOrThrow({ where: { id } });

  describe('documento rechazado por la DIAN', () => {
    it('una nota credito rechazada no acredita la factura origen', async () => {
      const source = (await invoicesService.emit(
        (await draft(100000)).id,
        actorId,
      )) as Invoice;

      const note = (await invoicesService.createNote(
        source.id,
        {
          items: [
            { description: 'x', quantity: 1, unitPrice: 100000, taxRate: 19 },
          ],
          reason: 'Ajuste',
        } as any,
        actorId,
      )) as Invoice;
      created.push(note.id);

      const before = await fresh(source.id);
      dianResponse.isValidated = false;
      dianResponse.errors = ['Regla: 0301, Error: documento invalido'];

      const emitted = (await invoicesService.emit(note.id, actorId)) as Invoice;
      const after = await fresh(source.id);

      expect(emitted.dianStatus).toBe(DianStatus.RECHAZADA);
      // El saldo del cliente no puede moverse por un documento sin valor legal.
      expect(after.balance.toNumber()).toBe(before.balance.toNumber());
      expect(after.creditBalance.toNumber()).toBe(
        before.creditBalance.toNumber(),
      );
      expect(after.paidAmount.toNumber()).toBe(before.paidAmount.toNumber());
    }, 120000);

    it('una factura rechazada no queda EMITIDA', async () => {
      const invoice = await draft(50000);
      dianResponse.isValidated = false;
      dianResponse.errors = ['Regla: 0302, Error: rechazo de prueba'];

      const emitted = (await invoicesService.emit(
        invoice.id,
        actorId,
      )) as Invoice;

      expect(emitted.dianStatus).toBe(DianStatus.RECHAZADA);
      expect(emitted.status).not.toBe(InvoiceStatus.EMITIDA);
    }, 120000);

    it('una factura rechazada devuelve el credito que habia compensado', async () => {
      // Cliente con 80.000 de saldo a favor y una factura de 50.000: la
      // compensacion ocurre antes del envio, asi que un rechazo debe
      // devolver ese credito a su origen.
      const donor = (await invoicesService.emit(
        (await draft(80000)).id,
        actorId,
      )) as Invoice;
      await prisma.invoice.update({
        where: { id: donor.id },
        data: { creditBalance: 80000 },
      });

      const invoice = await draft(50000);
      dianResponse.isValidated = false;
      dianResponse.errors = ['Regla: 0303, Error: rechazo con compensacion'];

      await invoicesService.emit(invoice.id, actorId);

      const donorAfter = await fresh(donor.id);
      expect(donorAfter.creditBalance.toNumber()).toBe(80000);
    }, 120000);
  });

  describe('payload DIAN vs ledger', () => {
    it('declara el paidAmount que quedo tras compensar el credito', async () => {
      // El credito a favor se registra sobre una factura ya emitida, con su
      // total real de 107100. La nueva factura de 60000 + IVA cuesta 71400.
      const donor = (await invoicesService.emit(
        (await draft(90000)).id,
        actorId,
      )) as Invoice;
      await prisma.invoice.update({
        where: { id: donor.id },
        data: { creditBalance: 90000 },
      });

      const invoice = await draft(60000);
      // Reintento: la factura ya tiene referenceCode, que es el caso en el que
      // antes se conservaba el snapshot previo a la compensacion.
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { referenceCode: 'REF-REINTENTO' },
      });

      const emitted = (await invoicesService.emit(
        invoice.id,
        actorId,
      )) as Invoice;

      // El donante tambien se emitio, asi que el payload de la factura bajo
      // prueba es la ultima llamada al adaptador, no la primera.
      const calls = factusAdapter.validateBills.mock.calls;
      const payload = calls[calls.length - 1][0] as any;
      const declared = Number(payload.payment_details[0].amount);
      const donorAfter = await fresh(donor.id);

      // El credito a favor (90000) cubre el total con IVA (71400), asi que la
      // factura queda pagada y el sobrante permanece en el donante.
      expect(emitted.total.toNumber()).toBe(71400);
      expect(emitted.paidAmount.toNumber()).toBe(71400);
      expect(emitted.balance.toNumber()).toBe(0);
      // Este es el nucleo de la regresión: el payload debe declarar lo que el
      // ledger tiene tras compensar, no el snapshot cargado antes de hacerlo.
      expect(declared).toBe(emitted.paidAmount.toNumber());
      expect(payload.payment_details[0].payment_form).toBe('1');
      expect(donorAfter.creditBalance.toNumber()).toBe(18600);
    }, 120000);

    it('sin credito disponible el payload declara el total y forma credito', async () => {
      const invoice = await draft(40000);
      const emitted = (await invoicesService.emit(
        invoice.id,
        actorId,
      )) as Invoice;
      const calls = factusAdapter.validateBills.mock.calls;
      const payload = calls[calls.length - 1][0] as any;

      expect(emitted.paidAmount.toNumber()).toBe(0);
      expect(Number(payload.payment_details[0].amount)).toBe(
        emitted.total.toNumber(),
      );
      expect(payload.payment_details[0].payment_form).toBe('2');
    }, 120000);
  });

  describe('concurrencia del credito', () => {
    it('dos emisiones simultaneas no pueden gastar el mismo credito', async () => {
      const donor = (await invoicesService.emit(
        (await draft(100000)).id,
        actorId,
      )) as Invoice;
      await prisma.invoice.update({
        where: { id: donor.id },
        data: { creditBalance: 100000 },
      });

      const a = await draft(80000);
      const b = await draft(80000);

      const [ra, rb] = await Promise.allSettled([
        invoicesService.emit(a.id, actorId),
        invoicesService.emit(b.id, actorId),
      ]);

      const donorAfter = await fresh(donor.id);
      const fa = await fresh(a.id);
      const fb = await fresh(b.id);

      // El credito nunca puede quedar negativo.
      expect(donorAfter.creditBalance.toNumber()).toBeGreaterThanOrEqual(0);
      // Ni gastarse mas de lo que existia.
      const compensated = fa.paidAmount.toNumber() + fb.paidAmount.toNumber();
      expect(compensated).toBeLessThanOrEqual(100000);
      // Y cada factura debe seguir cuadrando total = pagado + saldo.
      for (const f of [fa, fb]) {
        if (f.status === InvoiceStatus.BORRADOR) continue;
        expect(f.paidAmount.add(f.balance).toNumber()).toBeCloseTo(
          f.total.toNumber(),
          2,
        );
      }
      expect([ra.status, rb.status].some((s) => s === 'fulfilled')).toBe(true);
    }, 180000);
    it('un error del adapter devuelve el credito compensado', async () => {
      // Distinto del rechazo DIAN: aqui el envio ni siquiera ocurre. Si el
      // credito no se devolviera, el cliente perderia saldo a favor por un
      // fallo de red.
      const donor = (await invoicesService.emit(
        (await draft(80000)).id,
        actorId,
      )) as Invoice;
      await prisma.invoice.update({
        where: { id: donor.id },
        data: { creditBalance: 80000 },
      });

      factusAdapter.validateBills.mockRejectedValueOnce(
        new Error('socket hang up'),
      );

      const invoice = await draft(50000);
      await invoicesService.emit(invoice.id, actorId).catch(() => undefined);

      const donorAfter = await fresh(donor.id);
      expect(donorAfter.creditBalance.toNumber()).toBe(80000);

      resetDian();
    }, 120000);

    it('el credito restante se reasigna si otra emision gano la carrera', async () => {
      // 100.000 de credio y dos facturas de 80.000: solo una puede tomar todo,
      // pero la otra debe aprovechar el remanente en vez de quedarse sin
      // compensar por un bloqueo de fila.
      const donor = (await invoicesService.emit(
        (await draft(100000)).id,
        actorId,
      )) as Invoice;
      await prisma.invoice.update({
        where: { id: donor.id },
        data: { creditBalance: 100000 },
      });

      const a = await draft(80000);
      const b = await draft(80000);

      await Promise.allSettled([
        invoicesService.emit(a.id, actorId),
        invoicesService.emit(b.id, actorId),
      ]);

      const donorAfter = await fresh(donor.id);
      const fa = await fresh(a.id);
      const fb = await fresh(b.id);

      // El credito disponible se aprovecha por completo.
      expect(fa.paidAmount.toNumber() + fb.paidAmount.toNumber()).toBe(100000);
      expect(donorAfter.creditBalance.toNumber()).toBe(0);
    }, 180000);
  });

  describe('numeracion', () => {
    /**
     * `emit` usa la primera resolucion activa de tipo FACTURA por antiguedad.
     * Para no depender del estado real ni alterarlo, cada test crea la suya con
     * `createdAt` en el pasado (asi gana el orden) y un `numberingRangeId`
     * propio, y la elimina al terminar.
     */
    const withResolution = async (
      range: { next: number; to: number },
      body: (resolution: {
        id: string;
        from: number;
        to: number;
        next: number;
      }) => Promise<void>,
    ) => {
      const resolution = await prisma.resolution.create({
        data: {
          prefix: 'TST',
          resolutionNumber: `REGR-${suffix}-${created.length}`,
          from: range.next,
          to: range.to,
          next: range.next,
          type: 'FACTURA',
          isActive: true,
          ambient: 'HABILITACION',
          numberingRangeId: 900000000 + created.length,
          documentCode: '01',
          createdAt: new Date('1990-01-01T00:00:00.000Z'),
        },
      });
      try {
        await body(resolution);
      } finally {
        await prisma.resolution.deleteMany({ where: { id: resolution.id } });
      }
    };

    it('emitir una factura consume exactamente un numero de la resolucion', async () => {
      await withResolution({ next: 100, to: 200 }, async (before) => {
        const invoice = await draft(1000);
        const emitted = (await invoicesService.emit(
          invoice.id,
          actorId,
        )) as Invoice;
        const after = await prisma.resolution.findUniqueOrThrow({
          where: { id: before.id },
        });

        expect(after.next).toBe(before.next + 1);
        expect(emitted.factusNumber).toBeTruthy();
        expect(emitted.resolutionId).toBe(before.id);
      });
    }, 120000);

    it('el contador no pasa de `to` cuando el rango ya esta agotado', async () => {
      await withResolution({ next: 50, to: 50 }, async (resolution) => {
        const invoice = await draft(1000);
        await invoicesService.emit(invoice.id, actorId).catch(() => undefined);

        const after = await prisma.resolution.findUniqueOrThrow({
          where: { id: resolution.id },
        });

        // El numero puede venir de Factus, pero el espejo local no puede
        // avanzar mas alla del rango autorizado.
        expect(after.next).toBeLessThanOrEqual(resolution.to);
        expect(after.next).toBe(resolution.to);
      });
    }, 120000);

    it('no consume numero cuando la DIAN rechaza la factura', async () => {
      await withResolution({ next: 10, to: 99 }, async (resolution) => {
        const invoice = await draft(1000);
        dianResponse.isValidated = false;
        dianResponse.errors = ['Regla: 0305, Error: rechazo sin numero'];

        await invoicesService.emit(invoice.id, actorId).catch(() => undefined);

        const after = await prisma.resolution.findUniqueOrThrow({
          where: { id: resolution.id },
        });
        // El numero asignado queda registrado en la factura para traza, pero
        // el rango no se consume porque no existe documento valido.
        expect(after.next).toBe(resolution.next);
      });
    }, 120000);
  });

  describe('auditoria', () => {
    it('registra la emision de la factura', async () => {
      const invoice = await draft(1000);
      await invoicesService.emit(invoice.id, actorId);

      const logs = await prisma.auditLog.findMany({
        where: { entityId: invoice.id, action: AuditAction.EMIT },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    }, 120000);
  });

  describe('tipos de documento', () => {
    it('una nota debito rechazada tampoco altera la factura origen', async () => {
      const source = (await invoicesService.emit(
        (await draft(70000)).id,
        actorId,
      )) as Invoice;
      const before = await fresh(source.id);

      const note = (await invoicesService.createNote(
        source.id,
        {
          kind: InvoiceKind.NOTA_DEBITO,
          items: [
            { description: 'x', quantity: 1, unitPrice: 70000, taxRate: 19 },
          ],
        } as any,
        actorId,
      )) as Invoice;
      created.push(note.id);

      dianResponse.isValidated = false;
      dianResponse.errors = ['Regla: 0304, Error: rechazo nota debito'];

      const emitted = (await invoicesService.emit(note.id, actorId)) as Invoice;
      const after = await fresh(source.id);

      expect(emitted.dianStatus).toBe(DianStatus.RECHAZADA);
      expect(after.balance.toNumber()).toBe(before.balance.toNumber());
    }, 120000);
  });
});
