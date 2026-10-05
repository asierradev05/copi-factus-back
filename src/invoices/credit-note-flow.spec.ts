import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  DianStatus,
  DocumentType,
  InvoiceKind,
  InvoiceStatus,
  PaymentMethod,
  ServiceStatus,
  UserRole,
} from '@prisma/client';
import type { Invoice, Service } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../common/email/email.module';
import { SupabaseModule } from '../common/supabase/supabase.module';
import { FactusModule } from '../factus/factus.module';
import { CustomersService } from '../customers/customers.service';
import { ServicesService } from '../services/services.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';

/**
 * Cubre el efecto contable de las notas sobre su factura origen. Emite
 * documentos reales contra Factus en el ambiente configurado, por lo que
 * verifica a la vez el payload y la propagacion del credito.
 */
describe('Credit note accounting (integracion)', () => {
  let prisma: PrismaService;
  let customersService: CustomersService;
  let servicesService: ServicesService;
  let invoicesService: InvoicesService;
  let paymentsService: PaymentsService;

  let actorId: string;
  let serviceTypeId: string;
  let customerId: string;
  const suffix = Date.now().toString();
  const created: string[] = [];

  const emitInvoice = async (unitPrice: number, qty = 1) => {
    const itemCount = qty > 1 ? qty : 1;
    const items = Array.from({ length: itemCount }, (_, i) => ({
      description: `[TEST NC] linea ${i + 1}`,
      quantity: 1,
      unitPrice,
      discount: 0,
      taxRate: 19,
    }));
    const draft = (await invoicesService.createDraft(
      {
        customerId,
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        items,
      } as any,
      actorId,
    )) as Invoice;
    created.push(draft.id);

    const emitted = (await invoicesService.emit(draft.id, actorId)) as Invoice;
    return emitted;
  };

  /**
   * El sandbox de Factus es compartido: mientras otro cliente tenga un documento
   * pendiente de validación, la API rechaza los envios nuevos con "Se encontro
   * una factura pendiente de enviar a la DIAN". Es una condicion externa y
   * transitoria, no un defecto del codigo bajo prueba, asi que se reintenta con
   * espera creciente en vez de marcar la suite como roja.
   *
   * Solo se reintenta ese mensaje exacto: cualquier otro error sigue fallando
   * de inmediato para no tapar regresiones reales.
   */
  const CUADRA_COLA_DIAN = /pendiente (de|por) enviar a la DIAN/i;

  const emitWithRetry = async (invoiceId: string): Promise<Invoice> => {
    const intentos = 5;
    for (let i = 1; i <= intentos; i++) {
      try {
        return (await invoicesService.emit(invoiceId, actorId)) as Invoice;
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err);
        if (!CUADRA_COLA_DIAN.test(mensaje) || i === intentos) throw err;
        // Espera creciente: la cola del sandbox drena sola en segundos o en
        // minutos segun la carga de los demas clientes.
        const espera = 10_000 * i;
        console.warn(
          `[credit-note-flow] Cola DIAN ocupada (intento ${i}/${intentos}). ` +
            `Reintentando en ${espera / 1000}s.`,
        );
        await new Promise((r) => setTimeout(r, espera));
      }
    }
    throw new Error('inalcanzable');
  };

  const itemIdsOf = async (invoiceId: string) => {
    const rows = await prisma.invoiceItem.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        EmailModule,
        SupabaseModule,
        FactusModule,
      ],
      providers: [
        CustomersService,
        ServicesService,
        InvoicesService,
        PaymentsService,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    customersService = module.get(CustomersService);
    servicesService = module.get(ServicesService);
    invoicesService = module.get(InvoicesService);
    paymentsService = module.get(PaymentsService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-nc-${suffix}@copigrafica.dev`,
        fullName: 'Test NC User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;

    const serviceType = await prisma.serviceType.create({
      data: {
        name: `NC Type ${suffix}`,
        description: '[TEST] credit note service type',
        isActive: true,
      },
    });
    serviceTypeId = serviceType.id;

    const customer = await customersService.create(
      {
        name: `Cliente NC ${suffix}`,
        documentType: DocumentType.CC,
        documentNumber: `NC-${suffix}`,
        phone: `300-NC-${suffix}`,
        email: `cliente-nc-${suffix}@test.com`,
      } as any,
      actorId,
    );
    customerId = (customer as any).id;
  }, 180000);

  afterAll(async () => {
    // El borrado es secuencial contra Postgres remoto y ya no cabe en el
    // default de 5s de Jest: sin este timeout la suite falla al terminar,
    // despues de haber pasado todas las pruebas.
    for (const id of created) {
      await prisma.payment.deleteMany({ where: { invoiceId: id } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await prisma.invoice.deleteMany({ where: { id } });
    }
    await prisma.product.deleteMany({
      where: { code: { in: [`UN-${suffix}`, `UNK-${suffix}`] } },
    });
    await prisma.service.deleteMany({ where: { id: { in: created } } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.profile.deleteMany({
      where: { email: `test-nc-${suffix}@copigrafica.dev` },
    });
    await prisma.$disconnect();
  }, 180000);

  it('una nota credito parcial reduce el saldo de su factura origen', async () => {
    const invoice = await emitInvoice(100000);

    expect(invoice.status).toBe(InvoiceStatus.EMITIDA);
    expect(invoice.documentKind).toBe(InvoiceKind.FACTURA);
    const balanceBefore = invoice.balance.toNumber();
    expect(balanceBefore).toBeGreaterThan(0);

    const note = (await invoicesService.createNote(
      invoice.id,
      {
        kind: 'NOTA_CREDITO',
        correctionConceptCode: '1',
        observation: '[TEST] devolucion parcial',
      } as any,
      actorId,
    )) as Invoice;
    created.push(note.id);

    await emitWithRetry(note.id);

    const source = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });
    const noteRow = await prisma.invoice.findUnique({
      where: { id: note.id },
    });

    expect(noteRow?.status).toBe(InvoiceStatus.EMITIDA);
    expect(noteRow?.dianStatus).toBe(DianStatus.VALIDADA);
    expect(noteRow?.cufe).toBeNull();
    expect(noteRow?.cude).toBeTruthy();
    // El CUFE pertenece a la factura referenciada, nunca a la nota.
    expect(noteRow?.cude).not.toBe(source!.cufe);
    expect(source!.balance.toNumber()).toBeLessThan(balanceBefore);
    expect(source!.status).not.toBe(InvoiceStatus.CANCELADA);

    const pdf = await invoicesService.getPdfBuffer(note.id);
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 240000);

  it('una nota debito se emite y no acredita la factura origen', async () => {
    const invoice = await emitInvoice(50000);
    const balanceBefore = invoice.balance.toNumber();

    const note = (await invoicesService.createNote(
      invoice.id,
      {
        kind: 'NOTA_DEBITO',
        correctionConceptCode: '3',
        observation: '[TEST] nota debito',
      } as any,
      actorId,
    )) as Invoice;
    created.push(note.id);

    await emitWithRetry(note.id);

    const noteRow = await prisma.invoice.findUnique({
      where: { id: note.id },
    });
    const source = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });

    expect(noteRow?.status).toBe(InvoiceStatus.EMITIDA);
    expect(noteRow?.documentKind).toBe(InvoiceKind.NOTA_DEBITO);
    expect(noteRow?.dianStatus).toBe(DianStatus.VALIDADA);
    expect(source!.balance.toNumber()).toBe(balanceBefore);
  }, 240000);

  it('permite una segunda nota cuando la primera ya dejo la factura pagada', async () => {
    const invoice = await emitInvoice(40000, 2);
    const [firstItem, secondItem] = await itemIdsOf(invoice.id);
    const total = invoice.total.toNumber();

    const first = (await invoicesService.createNote(
      invoice.id,
      {
        kind: 'NOTA_CREDITO',
        correctionConceptCode: '1',
        observation: '[TEST] primera nota',
        itemIds: [firstItem],
      } as any,
      actorId,
    )) as Invoice;
    created.push(first.id);
    await emitWithRetry(first.id);

    const afterFirst = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });
    expect(afterFirst!.status).toBe(InvoiceStatus.PARCIALMENTE_PAGADA);
    expect(afterFirst!.balance.toNumber()).toBeGreaterThan(0);

    const second = (await invoicesService.createNote(
      invoice.id,
      {
        kind: 'NOTA_CREDITO',
        correctionConceptCode: '1',
        observation: '[TEST] segunda nota',
        itemIds: [secondItem],
      } as any,
      actorId,
    )) as Invoice;
    created.push(second.id);
    await emitWithRetry(second.id);

    const secondRow = await prisma.invoice.findUnique({
      where: { id: second.id },
    });
    expect(secondRow!.dianStatus).toBe(DianStatus.VALIDADA);
    expect(secondRow!.total.toNumber()).toBeLessThan(total);

    const afterSecond = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });
    expect(afterSecond!.balance.toNumber()).toBe(0);
    expect(afterSecond!.status).toBe(InvoiceStatus.PAGADA);
  }, 240000);

  it('una nota credito mayor al saldo deja saldo a favor en la factura', async () => {
    const invoice = await emitInvoice(30000);
    const total = invoice.total.toNumber();

    const note = (await invoicesService.createNote(
      invoice.id,
      {
        kind: 'NOTA_CREDITO',
        correctionConceptCode: '2',
        observation: '[TEST] anulacion total',
      } as any,
      actorId,
    )) as Invoice;
    created.push(note.id);

    await emitWithRetry(note.id);

    const source = await prisma.invoice.findUnique({
      where: { id: invoice.id },
    });

    expect(source!.balance.toNumber()).toBe(0);
    expect(source!.status).not.toBe(InvoiceStatus.CANCELADA);
    expect(source!.creditBalance.toNumber()).toBeLessThanOrEqual(total);
  }, 240000);

  it('una nota credito que excede lo pagado no deja el saldo en contra', async () => {
    // El cliente pagó 80 de una factura de 119 y devuelve todo. La NC por 119
    // excede el saldo pendiente (39), pero NO es un error: el excedente es
    // justo el dinero que hay que devolverle, así que va a `creditBalance` y el
    // saldo queda en cero. El total de la NC sigue siendo el único tope: nunca
    // puede superar el total de la factura.
    const invoice = await emitInvoice(100000);
    const total = invoice.total.toNumber();

    await paymentsService.register(
      {
        invoiceId: invoice.id,
        amount: 80000,
        paymentMethod: PaymentMethod.TRANSFERENCIA,
        paymentDate: new Date().toISOString(),
      } as any,
      actorId,
    );

    const pending = total - 80000;
    expect(pending).toBeGreaterThan(0);

    const note = (await invoicesService.createNote(
      invoice.id,
      {
        kind: 'NOTA_CREDITO',
        correctionConceptCode: '1',
        observation: '[TEST] NC que excede lo pagado',
      } as any,
      actorId,
    )) as Invoice;
    created.push(note.id);
    await emitWithRetry(note.id);

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });

    // El saldo nunca queda en contra: es la condicion que hace que este caso
    // sea contable en vez de ser un descuadre.
    expect(after.balance.toNumber()).toBe(0);
    // Y lo que se le devuelve es exactamente lo que habia pagado.
    expect(after.creditBalance.toNumber()).toBe(80000);
    expect(after.paidAmount.toNumber()).toBe(80000);
    expect(after.status).toBe(InvoiceStatus.PAGADA);
  }, 240000);

  describe('unidades y rama en el payload DIAN', () => {
    it('la linea toma la unidad y la rama del producto', async () => {
      const product = await prisma.product.create({
        data: {
          code: `UN-${suffix}`,
          name: `[TEST UN] servicio por hora`,
          unitPrice: 60000,
          taxRate: 19,
          // UN/CE 75 = Hora. El sandbox de Factus rechaza codigos inventados,
          // asi que se usan los de la tabla oficial.
          unitMeasureCode: '75',
          standardCode: '999',
        },
      });

      const draft = (await invoicesService.createDraft(
        {
          customerId,
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          items: [
            {
              productId: product.id,
              description: `[TEST UN] hora de diseno`,
              quantity: 2,
              unitPrice: 60000,
              taxRate: 19,
            },
          ],
        } as any,
        actorId,
      )) as Invoice;
      created.push(draft.id);

      const item = await prisma.invoiceItem.findFirstOrThrow({
        where: { invoiceId: draft.id },
      });

      expect(item.unitMeasureCode).toBe('75');
      expect(item.standardCode).toBe('999');

      await prisma.product.delete({ where: { id: product.id } });
    }, 120000);

    it('la nota replica la unidad y la rama de la linea que credita', async () => {
      // Si la nota cayera al default "94" (UNIDAD) mientras la linea origen
      // estaba en KGM, la DIAN recibiria una NC en KG creditando una linea en KG
      // declarada como UNIDAD, que rechaza.
      const product = await prisma.product.create({
        data: {
          code: `UNK-${suffix}`,
          name: `[TEST UN] papel por kilogramo`,
          unitPrice: 25000,
          taxRate: 19,
          // UN/CE KGM = Kilogramo. El codigo lleva letras: una validacion que
          // solo acepte digitos rechazaria una unidad valida.
          unitMeasureCode: 'KGM',
          standardCode: '999',
        },
      });

      const draft = (await invoicesService.createDraft(
        {
          customerId,
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          items: [
            {
              productId: product.id,
              description: `[TEST UN] kilogramo de tinta`,
              quantity: 3,
              unitPrice: 25000,
              taxRate: 19,
            },
          ],
        } as any,
        actorId,
      )) as Invoice;
      created.push(draft.id);
      await emitWithRetry(draft.id);

      const note = (await invoicesService.createNote(
        draft.id,
        {
          kind: 'NOTA_CREDITO',
          correctionConceptCode: '1',
          observation: '[TEST UN] devolucion por unidad',
        } as any,
        actorId,
      )) as Invoice;
      created.push(note.id);

      const sourceItem = await prisma.invoiceItem.findFirstOrThrow({
        where: { invoiceId: draft.id },
      });
      const noteItem = await prisma.invoiceItem.findFirstOrThrow({
        where: { invoiceId: note.id },
      });

      expect(noteItem.unitMeasureCode).toBe(sourceItem.unitMeasureCode);
      expect(noteItem.standardCode).toBe(sourceItem.standardCode);
      expect(noteItem.unitMeasureCode).toBe('KGM');
      expect(noteItem.standardCode).toBe('999');

      await prisma.product.delete({ where: { id: product.id } });
    }, 120000);

    it('una linea sin producto explicito cae al default UNIDAD', async () => {
      const draft = (await invoicesService.createDraft(
        {
          customerId,
          dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          items: [
            {
              description: `[TEST UN] servicio simple`,
              quantity: 1,
              unitPrice: 15000,
              taxRate: 19,
            },
          ],
        } as any,
        actorId,
      )) as Invoice;
      created.push(draft.id);

      const item = await prisma.invoiceItem.findFirstOrThrow({
        where: { invoiceId: draft.id },
      });
      expect(item.unitMeasureCode).toBe('94');
      expect(item.standardCode).toBe('999');
    }, 120000);
  });
});
