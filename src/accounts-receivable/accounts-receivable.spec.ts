import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AuditAction,
  DianStatus,
  DocumentType,
  InvoiceKind,
  InvoiceStatus,
  PaymentMethod,
  UserRole,
} from '@prisma/client';
import type { Invoice } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AccountsReceivableModule } from './accounts-receivable.module';
import { AccountsReceivableService } from './accounts-receivable.service';
import {
  buildReceivableSummaryWhere,
  buildReceivableWhere,
} from './accounts-receivable.filter';

/**
 * Cartera: que entra al computo y con que urgencia. Un error aqui se traduce
 * en cobros a clientes que no deben o en saldos que nadie reclama, asi que se
 * fija contra la base real y no contra mocks.
 *
 * In invariantes que fija:
 *  - una nota credito nunca aparece como exigible (su efecto ya esta en la
 *    factura origen); duplicarla cobraria de mas;
 *  - una nota debito si es exigible: aumenta lo adeudado;
 *  - solo entran los estados que aun admiten cobro;
 *  - `VENCIDA` se persiste al listar, no se calcula solo en la respuesta.
 */
describe('Accounts receivable', () => {
  let prisma: PrismaService;
  let service: AccountsReceivableService;

  let actorId: string;
  let customerId: string;
  const created: string[] = [];
  const customerIds: string[] = [];
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const savedFallback = process.env.ALLOW_IN_MEMORY_FALLBACK;

  const newCustomer = async () => {
    const n = customerIds.length;
    const customer = await prisma.customer.create({
      data: {
        name: `Cartera ${suffix}-${n}`,
        documentType: DocumentType.CC,
        documentNumber: `CAR-${suffix}-${n}`,
        phone: `2${String(n).padStart(2, '0')}${suffix.slice(-7)}`,
        email: `cartera-${suffix}-${n}@test.com`,
      } as any,
    });
    customerIds.push(customer.id);
    return customer.id;
  };

  /**
   * Acepta numeros planos a proposito. Tiparlo como `Partial<Invoice>` lo
   * convertiria en `Decimal & number` por interseccion y obligaria a cada
   * test a construir Decimales de Prisma.
   */
  type SeedInvoiceInput = {
    total: number;
    balance: number;
    status?: InvoiceStatus;
    documentKind?: InvoiceKind;
    paidAmount?: number;
    creditBalance?: number;
    issueDate?: Date;
    dueDate?: Date;
    createdById?: string | null;
    [key: string]: unknown;
  };

  /** Crea una factura ya en un estado concreto, sin pasar por emision. */
  const seedInvoice = async (data: SeedInvoiceInput) => {
    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        status: InvoiceStatus.EMITIDA,
        documentKind: InvoiceKind.FACTURA,
        subtotal: data.total,
        taxTotal: 0,
        discountTotal: 0,
        paidAmount: data.paidAmount ?? 0,
        creditBalance: data.creditBalance ?? 0,
        issueDate: new Date(),
        dueDate: data.dueDate ?? new Date(),
        createdById: actorId,
        // Al final: los tests pueden forzar total, balance, status o dueDate.
        ...data,
      } as any,
    });
    created.push(invoice.id);
    return invoice;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AccountsReceivableModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    service = module.get(AccountsReceivableService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-ar-${suffix}@copigrafica.dev`,
        fullName: 'Test Cartera',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;
  }, 180000);

  beforeEach(async () => {
    process.env.ALLOW_IN_MEMORY_FALLBACK = 'false';
    customerId = await newCustomer();
  }, 60000);

  afterAll(async () => {
    if (savedFallback === undefined) {
      delete process.env.ALLOW_IN_MEMORY_FALLBACK;
    } else {
      process.env.ALLOW_IN_MEMORY_FALLBACK = savedFallback;
    }
    await prisma.payment.deleteMany({ where: { invoiceId: { in: created } } });
    await prisma.invoiceItem.deleteMany({
      where: { invoiceId: { in: created } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: created } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.profile.deleteMany({
      where: { email: `test-ar-${suffix}@copigrafica.dev` },
    });
    // La auditoria de vencimientos se escribe sin `userId` (la dispara una
    // lectura, no un usuario), asi que hay que borrarla por entidad.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: actorId },
          { entityType: 'Invoice', entityId: { in: created } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  describe('filtro de exigibilidad', () => {
    it('excluye notas credito e incluye notas debito', () => {
      expect(buildReceivableWhere().documentKind).toEqual({
        in: [InvoiceKind.FACTURA, InvoiceKind.NOTA_DEBITO],
      });
      expect(buildReceivableWhere().documentKind).not.toEqual({
        in: expect.arrayContaining([InvoiceKind.NOTA_CREDITO]),
      });
    });

    it('solo admite estados que aun aceptan cobro', () => {
      const statuses = (
        buildReceivableWhere().status as { in: InvoiceStatus[] }
      ).in;
      expect(statuses).toEqual(
        expect.arrayContaining([
          InvoiceStatus.EMITIDA,
          InvoiceStatus.PARCIALMENTE_PAGADA,
          InvoiceStatus.VENCIDA,
        ]),
      );
      // Borrador y cancelada no son exigibles; pagada ya no tiene saldo.
      expect(statuses).not.toContain(InvoiceStatus.BORRADOR);
      expect(statuses).not.toContain(InvoiceStatus.CANCELADA);
      expect(statuses).not.toContain(InvoiceStatus.PAGADA);
    });

    it('exige saldo positivo en la lista pero no en el resumen', () => {
      expect(buildReceivableWhere().balance).toEqual({ gt: 0 });
      // El resumen cuenta sobre el mismo conjunto pero filtra saldo en memoria,
      // asi que no debe duplicar el criterio y perderia documentos.
      expect(buildReceivableSummaryWhere().balance).toBeUndefined();
    });
  });

  describe('listado y urgencia', () => {
    it('marca VENCIDA y lo persiste, no solo lo calcula en la respuesta', async () => {
      const past = new Date(Date.now() - 10 * 86400000);
      const invoice = await seedInvoice({
        total: 100000,
        balance: 100000,
        dueDate: past,
      });

      const page = await service.list({ page: 1, limit: 50 });
      const row = page.data.find((r) => r.id === invoice.id);

      expect(row).toBeDefined();
      expect(row!.isOverdue).toBe(true);
      expect(row!.status).toBe(InvoiceStatus.VENCIDA);
      expect(row!.urgency).toBe('VENCIDA');
      expect(row!.daysOverdue).toBeGreaterThanOrEqual(10);

      // El efecto debe quedar en la base: el dashboard y los PDFs leen de ahi.
      const persisted = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(persisted.status).toBe(InvoiceStatus.VENCIDA);
    }, 60000);

    it('una factura al dia queda AL_DIA con dias restantes', async () => {
      const future = new Date(Date.now() + 20 * 86400000);
      const invoice = await seedInvoice({
        total: 50000,
        balance: 50000,
        dueDate: future,
      });

      const page = await service.list({ page: 1, limit: 50 });
      const row = page.data.find((r) => r.id === invoice.id);

      expect(row!.isOverdue).toBe(false);
      expect(row!.urgency).toBe('AL_DIA');
      expect(row!.daysRemaining).toBeGreaterThan(0);
      expect(row!.status).toBe(InvoiceStatus.EMITIDA);
    }, 60000);

    it('una factura que vence en breve queda PROXIMA', async () => {
      const soon = new Date(Date.now() + 3 * 86400000);
      const invoice = await seedInvoice({
        total: 10000,
        balance: 10000,
        dueDate: soon,
      });

      const page = await service.list({ page: 1, limit: 50 });
      const row = page.data.find((r) => r.id === invoice.id);

      expect(row!.urgency).toBe('PROXIMA');
      expect(row!.isOverdue).toBe(false);
    }, 60000);

    it('un saldo en cero no aparece en la cartera', async () => {
      const invoice = await seedInvoice({
        total: 30000,
        balance: 0,
        paidAmount: 30000,
        status: InvoiceStatus.PAGADA,
        dueDate: new Date(Date.now() - 5 * 86400000),
      });

      const page = await service.list({ page: 1, limit: 50 });
      expect(page.data.find((r) => r.id === invoice.id)).toBeUndefined();
    }, 60000);
  });

  describe('resumen', () => {
    /**
     * `getSummary` agrega toda la cartera, no solo el cliente del test, asi que
     * las cifras se comparan como delta contra una linea base tomada antes de
     * sembrar. Asi el test sigue siendo valido con datos reales en la base.
     */
    const snapshot = async () => {
      const s = await service.getSummary();
      return {
        receivable: Number(s.totalReceivable),
        overdue: Number(s.totalOverdue),
        overdueCount: s.overdueCount,
        open: s.openInvoicesCount,
      };
    };

    it('suma solo lo exigible y separa lo vencido', async () => {
      const past = new Date(Date.now() - 3 * 86400000);
      const future = new Date(Date.now() + 30 * 86400000);

      const before = await snapshot();
      await seedInvoice({ total: 100000, balance: 100000, dueDate: past });
      await seedInvoice({ total: 50000, balance: 50000, dueDate: future });
      // Una nota credito ya pagada no es exigible y no debe sumar nada.
      await seedInvoice({
        total: 80000,
        balance: 0,
        paidAmount: 80000,
        status: InvoiceStatus.PAGADA,
        documentKind: InvoiceKind.NOTA_CREDITO,
        dueDate: past,
      });

      const after = await snapshot();

      expect(after.open - before.open).toBe(2);
      expect(after.receivable - before.receivable).toBe(150000);
      expect(after.overdue - before.overdue).toBe(100000);
      expect(after.overdueCount - before.overdueCount).toBe(1);
    }, 60000);

    it('un cliente sin documentos no altera el resumen', async () => {
      const before = await snapshot();
      await newCustomer();
      const after = await snapshot();

      expect(after.receivable).toBe(before.receivable);
      expect(after.overdue).toBe(before.overdue);
      expect(after.open).toBe(before.open);
      expect(after.overdueCount).toBe(before.overdueCount);
    }, 60000);

    it('una factura pagada no aparece en el resumen', async () => {
      const before = await snapshot();
      await seedInvoice({
        total: 40000,
        balance: 0,
        paidAmount: 40000,
        status: InvoiceStatus.PAGADA,
        dueDate: new Date(Date.now() - 5 * 86400000),
      });
      const after = await snapshot();

      expect(after.open - before.open).toBe(0);
      expect(after.receivable - before.receivable).toBe(0);
      expect(after.overdue - before.overdue).toBe(0);
    }, 60000);
  });

  describe('estado de cuenta del cliente', () => {
    it('cuadra facturado, pagado y saldo del cliente', async () => {
      const invoice = await seedInvoice({
        total: 119000,
        balance: 19000,
        paidAmount: 100000,
        dueDate: new Date(Date.now() + 10 * 86400000),
      });

      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          customerId,
          amount: 100000,
          paymentMethod: PaymentMethod.TRANSFERENCIA,
          paymentDate: new Date(),
          createdById: actorId,
        },
      });

      const statement = await service.getCustomerStatement(customerId);

      expect(statement.summary.totalInvoiced).toBe('119000.00');
      expect(statement.summary.totalPaid).toBe('100000.00');
      expect(statement.summary.balance).toBe('19000.00');
      expect(statement.summary.overdueCount).toBe(0);
      expect(statement.invoices).toHaveLength(1);
      expect(statement.payments).toHaveLength(1);
    }, 60000);

    it('cuenta como vencidas las facturas con saldo y vencimiento pasado', async () => {
      await seedInvoice({
        total: 50000,
        balance: 50000,
        dueDate: new Date(Date.now() - 2 * 86400000),
      });

      const statement = await service.getCustomerStatement(customerId);
      expect(statement.summary.overdueCount).toBe(1);
    }, 60000);

    it('un cliente sin documentos devuelve totales en cero', async () => {
      const empty = await newCustomer();
      const statement = await service.getCustomerStatement(empty);

      expect(statement.summary.totalInvoiced).toBe('0.00');
      expect(statement.summary.totalPaid).toBe('0.00');
      expect(statement.summary.balance).toBe('0.00');
      expect(statement.invoices).toEqual([]);
      expect(statement.payments).toEqual([]);
    }, 60000);
  });

  describe('paginacion', () => {
    it('respeta pagina y limite y pagina sin solapamiento', async () => {
      for (let i = 0; i < 3; i += 1) {
        await seedInvoice({
          total: 10000 + i,
          balance: 10000 + i,
          dueDate: new Date(Date.now() + (i + 1) * 86400000),
        });
      }

      // El filtro de la cartera es global, asi que se leen todas las paginas y
      // se toman las filas del cliente del test para comprobar la paginacion.
      const collect = async () => {
        const rows: any[] = [];
        let page = 1;
        let total = 0;
        let totalPages = 0;
        do {
          const res = await service.list({ page, limit: 2 });
          rows.push(...res.data);
          total = res.meta.total;
          totalPages = res.meta.totalPages;
          page += 1;
        } while (page <= totalPages && page <= 50);
        return { rows, total, totalPages };
      };

      const first = await service.list({ page: 1, limit: 2 });
      expect(first.data.length).toBe(2);
      expect(first.meta.page).toBe(1);
      expect(first.meta.limit).toBe(2);
      expect(first.meta.totalPages).toBe(Math.ceil(first.meta.total / 2));

      const { rows, total } = await collect();
      const mine = rows.filter((r) => r.customerId === customerId);

      expect(total).toBe(rows.length);
      expect(mine).toHaveLength(3);
      // Ninguna factura se repite ni se pierde entre paginas.
      expect(new Set(mine.map((r) => r.id)).size).toBe(3);
    }, 60000);

    it('los importes se serializan como texto con dos decimales', async () => {
      const invoice = await seedInvoice({
        total: 12345.67,
        balance: 2345.67,
        paidAmount: 10000,
      });

      const page = await service.list({ page: 1, limit: 50 });
      const row = page.data.find((r) => r.id === invoice.id)!;

      // El frontend formatea estos valores; si vuelven como number se pierden
      // los centavos en pantalla.
      expect(typeof row.total).toBe('string');
      expect(typeof row.balance).toBe('string');
      expect(row.total).toBe('12345.67');
      expect(row.balance).toBe('2345.67');
    }, 60000);
  });

  describe('notas dentro de la cartera', () => {
    it('una nota debito suma al adeudado del cliente', async () => {
      const before = Number((await service.getSummary()).totalReceivable);
      await seedInvoice({
        total: 100000,
        balance: 100000,
        documentKind: InvoiceKind.NOTA_DEBITO,
        dueDate: new Date(Date.now() + 15 * 86400000),
      });

      const after = Number((await service.getSummary()).totalReceivable);
      expect(after - before).toBe(100000);
    }, 60000);

    it('una nota credito con saldo a favor no genera exigibilidad', async () => {
      // Una NC deja el excedente en `creditBalance`, no en `balance`: si
      // `balance` quedara en cero, no debe generar nada cobrable.
      const before = Number((await service.getSummary()).totalReceivable);
      await seedInvoice({
        total: 50000,
        balance: 0,
        paidAmount: 0,
        creditBalance: 50000,
        documentKind: InvoiceKind.NOTA_CREDITO,
        dueDate: new Date(Date.now() - 1 * 86400000),
      });

      const after = Number((await service.getSummary()).totalReceivable);
      expect(after).toBe(before);

      const page = await service.list({ page: 1, limit: 100 });
      const row = page.data.find((r) => r.customerId === customerId);
      expect(row).toBeUndefined();
    }, 60000);
  });

  describe('documentos rechazados por la DIAN', () => {
    it('un rechazado no aparece en la cartera ni suma al resumen', async () => {
      // La emision rechazada vuelve a BORRADOR, pero el filtro no debe depender
      // solo de eso: si un rechazo quedara con status cobrable por un descuido,
      // seguira sin ser exigible.
      const before = Number((await service.getSummary()).totalReceivable);
      await seedInvoice({
        total: 120000,
        balance: 120000,
        status: InvoiceStatus.EMITIDA,
        dianStatus: DianStatus.RECHAZADA,
        dueDate: new Date(Date.now() + 5 * 86400000),
      });

      const after = Number((await service.getSummary()).totalReceivable);
      expect(after).toBe(before);

      const page = await service.list({ page: 1, limit: 100 });
      const row = page.data.find((r) => r.customerId === customerId);
      expect(row).toBeUndefined();
    }, 60000);

    it('una nota debito rechazada tampoco suma', async () => {
      const before = Number((await service.getSummary()).totalReceivable);
      await seedInvoice({
        total: 90000,
        balance: 90000,
        documentKind: InvoiceKind.NOTA_DEBITO,
        status: InvoiceStatus.EMITIDA,
        dianStatus: DianStatus.RECHAZADA,
        dueDate: new Date(Date.now() + 5 * 86400000),
      });

      const after = Number((await service.getSummary()).totalReceivable);
      expect(after).toBe(before);
    }, 60000);

    it('un documento validado si aparece', async () => {
      await seedInvoice({
        total: 30000,
        balance: 30000,
        status: InvoiceStatus.EMITIDA,
        dianStatus: DianStatus.VALIDADA,
        dueDate: new Date(Date.now() + 5 * 86400000),
      });

      const page = await service.list({ page: 1, limit: 100 });
      const row = page.data.find((r) => r.customerId === customerId);
      expect(row).toBeDefined();
    }, 60000);
  });

  describe('auditoria del cambio de estado', () => {
    it('deja rastro del estado anterior y del nuevo al marcar vencida', async () => {
      const invoice = await seedInvoice({
        total: 10000,
        balance: 10000,
        status: InvoiceStatus.EMITIDA,
        dueDate: new Date(Date.now() - 30 * 86400000),
      });

      await service.list({ page: 1, limit: 50 });

      const log = await prisma.auditLog.findFirst({
        where: {
          entityId: invoice.id,
          entityType: 'Invoice',
          action: AuditAction.UPDATE,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(log).not.toBeNull();
      expect(log!.oldValue).toMatchObject({ status: InvoiceStatus.EMITIDA });
      expect(log!.newValue).toMatchObject({ status: InvoiceStatus.VENCIDA });
    }, 60000);

    it('no duplica auditoria cuando la factura ya estaba vencida', async () => {
      const invoice = await seedInvoice({
        total: 10000,
        balance: 10000,
        status: InvoiceStatus.VENCIDA,
        dueDate: new Date(Date.now() - 30 * 86400000),
      });

      await service.list({ page: 1, limit: 50 });
      await service.list({ page: 1, limit: 50 });

      const logs = await prisma.auditLog.count({
        where: { entityId: invoice.id, entityType: 'Invoice' },
      });
      expect(logs).toBe(0);
    }, 60000);
  });
});
