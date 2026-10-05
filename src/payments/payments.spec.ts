import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  AuditAction,
  DocumentType,
  InvoiceKind,
  InvoiceStatus,
  PaymentMethod,
  UserRole,
} from '@prisma/client';
import type { Invoice } from '@prisma/client';
import { decimalToNumber, toDecimal } from '../common/utils/money.util';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';

/**
 * Pagos: el invariante central es que `paidAmount` nunca supere lo que el
 * cliente debia, y que el pago nunca se acepte por mas de lo pendiente.
 *
 * Riesgo concreto que fija: la compensacion de credito a favor escribe
 * `paidAmount` sin crear filas en `payments`. Si el servicio de pagos calcula lo
 * ya pagado sumando `payments`, veria cero y admitiria un segundo pago del
 * mismo monto: el cliente pagaria dos veces la misma factura.
 */
describe('Payments', () => {
  let prisma: PrismaService;
  let service: PaymentsService;

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
        name: `Pagos ${suffix}-${n}`,
        documentType: DocumentType.CC,
        documentNumber: `PAG-${suffix}-${n}`,
        phone: `1${String(n).padStart(2, '0')}${suffix.slice(-7)}`,
        email: `pagos-${suffix}-${n}@test.com`,
      } as any,
    });
    customerIds.push(customer.id);
    return customer.id;
  };

  /** Numeros planos a proposito: `Partial<Invoice>` intersecaria a Decimal. */
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

  const paymentDto = (
    invoiceId: string,
    amount: number,
    overrides: Record<string, unknown> = {},
  ) =>
    ({
      invoiceId,
      amount,
      paymentMethod: PaymentMethod.EFECTIVO,
      paymentDate: new Date().toISOString(),
      ...overrides,
    }) as any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        PaymentsModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    service = module.get(PaymentsService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-pay-${suffix}@copigrafica.dev`,
        fullName: 'Test Pagos',
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
    await prisma.auditLog.deleteMany({ where: { userId: actorId } });
    await prisma.profile.deleteMany({
      where: { email: `test-pay-${suffix}@copigrafica.dev` },
    });
    await prisma.$disconnect();
  });

  describe('ledger tras compensacion de credito', () => {
    it('no admite un segundo pago de un monto ya compensado', async () => {
      // Caso real: una NC de 150 contra una factura de 100 deja 50 de credito a
      // favor. Ese credito se consumio compensando otra factura, lo que escribio
      // `paidAmount` sin crear filas en `payments`.
      const invoice = await seedInvoice({
        total: 100000,
        paidAmount: 100000,
        balance: 0,
        dueDate: new Date(Date.now() + 10 * 86400000),
      });

      // No hay pagos registrados: el saldo vino de la compensacion.
      const payments = await prisma.payment.count({
        where: { invoiceId: invoice.id },
      });
      expect(payments).toBe(0);

      // Aun asi, la factura esta pagada: un pago adicional debe rechazarse.
      await expect(
        service.register(paymentDto(invoice.id, 50000), actorId),
      ).rejects.toThrow();

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(after.paidAmount.toNumber()).toBe(100000);
      expect(after.balance.toNumber()).toBe(0);
    }, 60000);

    it('el saldo pendiente ya descontado del credito a favor se respeta', async () => {
      // Factura de 100 con 30 de credito a favor propio: lo que el cliente debe
      // es 70, no 100.
      const invoice = await seedInvoice({
        total: 100000,
        balance: 70000,
        creditBalance: 30000,
        dueDate: new Date(Date.now() + 10 * 86400000),
      });

      await expect(
        service.register(paymentDto(invoice.id, 80000), actorId),
      ).rejects.toThrow(/excede el saldo pendiente/i);

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(after.paidAmount.toNumber()).toBe(0);
      expect(after.balance.toNumber()).toBe(70000);
    }, 60000);
  });

  describe('pagos validos', () => {
    it('un pago parcial deja PARCIALMENTE_PAGADA y descuenta el saldo', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });

      const result = await service.register(
        paymentDto(invoice.id, 40000),
        actorId,
      );

      expect(decimalToNumber(toDecimal(result.payment.amount))).toBe(40000);
      expect(result.updatedInvoice.status).toBe(
        InvoiceStatus.PARCIALMENTE_PAGADA,
      );
      expect(decimalToNumber(toDecimal(result.updatedInvoice.paidAmount))).toBe(
        40000,
      );
      expect(decimalToNumber(toDecimal(result.updatedInvoice.balance))).toBe(
        60000,
      );
    }, 60000);

    it('un pago que liquida la factura deja PAGADA y saldo cero', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });

      const result = await service.register(
        paymentDto(invoice.id, 100000),
        actorId,
      );

      expect(result.updatedInvoice.status).toBe(InvoiceStatus.PAGADA);
      expect(result.updatedInvoice.paidAmount.toNumber()).toBe(100000);
      expect(result.updatedInvoice.balance.toNumber()).toBe(0);
    }, 60000);

    it('varios pagos acumulados cierran en el total sin pasarse', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });

      await service.register(paymentDto(invoice.id, 30000), actorId);
      await service.register(paymentDto(invoice.id, 30000), actorId);
      const result = await service.register(
        paymentDto(invoice.id, 40000),
        actorId,
      );

      expect(result.updatedInvoice.status).toBe(InvoiceStatus.PAGADA);
      expect(result.updatedInvoice.paidAmount.toNumber()).toBe(100000);
      expect(result.updatedInvoice.balance.toNumber()).toBe(0);

      // Cuarto pago: ya no hay saldo.
      await expect(
        service.register(paymentDto(invoice.id, 1), actorId),
      ).rejects.toThrow();
    }, 60000);

    it('conserva referencia y notas tras recortarlos', async () => {
      const invoice = await seedInvoice({ total: 50000, balance: 50000 });

      const result = await service.register(
        paymentDto(invoice.id, 10000, {
          reference: '  REC-123  ',
          notes: '  pago parcial  ',
        }),
        actorId,
      );

      expect(result.payment.reference).toBe('REC-123');
      expect(result.payment.notes).toBe('pago parcial');
    }, 60000);

    it('un pago que cubre exactamente el saldo descontando el credito cierra la factura', async () => {
      const invoice = await seedInvoice({
        total: 100000,
        balance: 70000,
        creditBalance: 30000,
      });

      const result = await service.register(
        paymentDto(invoice.id, 70000),
        actorId,
      );

      expect(result.updatedInvoice.balance.toNumber()).toBe(0);
      expect(result.updatedInvoice.status).toBe(InvoiceStatus.PAGADA);
    }, 60000);
  });

  describe('validaciones', () => {
    it('rechaza montos no positivos', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });

      await expect(
        service.register(paymentDto(invoice.id, 0), actorId),
      ).rejects.toThrow(/mayor a cero/i);
      await expect(
        service.register(paymentDto(invoice.id, -5000), actorId),
      ).rejects.toThrow(/mayor a cero/i);

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(after.paidAmount.toNumber()).toBe(0);
    }, 60000);

    it('rechaza pagos en facturas borrador', async () => {
      const invoice = await seedInvoice({
        total: 100000,
        balance: 100000,
        status: InvoiceStatus.BORRADOR,
      });

      await expect(
        service.register(paymentDto(invoice.id, 1000), actorId),
      ).rejects.toThrow(/borrador o canceladas/i);
    }, 60000);

    it('rechaza pagos en facturas canceladas', async () => {
      const invoice = await seedInvoice({
        total: 100000,
        balance: 100000,
        status: InvoiceStatus.CANCELADA,
      });

      await expect(
        service.register(paymentDto(invoice.id, 1000), actorId),
      ).rejects.toThrow(/borrador o canceladas/i);
    }, 60000);

    it('rechaza pagos sobre una nota credito', async () => {
      const invoice = await seedInvoice({
        total: 50000,
        balance: 50000,
        documentKind: InvoiceKind.NOTA_CREDITO,
      });

      await expect(
        service.register(paymentDto(invoice.id, 1000), actorId),
      ).rejects.toThrow(/nota cr/i);
    }, 60000);

    it('rechaza una factura inexistente', async () => {
      await expect(
        service.register(paymentDto('no-existe', 1000), actorId),
      ).rejects.toThrow(/no encontrada/i);
    }, 60000);

    it('rechaza un pago mayor al saldo', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });

      await expect(
        service.register(paymentDto(invoice.id, 150000), actorId),
      ).rejects.toThrow(/excede el saldo pendiente/i);
    }, 60000);
  });

  describe('consulta de pagos', () => {
    it('filtra por factura', async () => {
      const a = await seedInvoice({ total: 100000, balance: 100000 });
      const b = await seedInvoice({ total: 100000, balance: 100000 });

      await service.register(paymentDto(a.id, 10000), actorId);
      await service.register(paymentDto(b.id, 20000), actorId);

      const page = await service.findAll({ invoiceId: a.id });
      expect(page.data).toHaveLength(1);
      expect(page.data[0].amount.toNumber()).toBe(10000);
      expect(page.meta.total).toBe(1);
    }, 60000);

    it('filtra por cliente y ordena por fecha descendente', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });

      await service.register(
        paymentDto(invoice.id, 10000, {
          paymentDate: new Date(Date.now() - 5 * 86400000).toISOString(),
        }),
        actorId,
      );
      await service.register(
        paymentDto(invoice.id, 20000, {
          paymentDate: new Date().toISOString(),
        }),
        actorId,
      );

      const page = await service.findAll({ customerId });
      const mine = page.data.filter((p) => p.customerId === customerId);

      expect(mine).toHaveLength(2);
      expect(mine[0].paymentDate.getTime()).toBeGreaterThanOrEqual(
        mine[1].paymentDate.getTime(),
      );
    }, 60000);

    it('incluye la factura y el cliente en cada pago', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });
      await service.register(paymentDto(invoice.id, 10000), actorId);

      const page = await service.findAll({ invoiceId: invoice.id });
      expect(page.data[0].invoice).toBeDefined();
      expect(page.data[0].customer).toBeDefined();
    }, 60000);
  });

  describe('auditoria', () => {
    it('registra el pago con su monto', async () => {
      const invoice = await seedInvoice({ total: 100000, balance: 100000 });
      const result = await service.register(
        paymentDto(invoice.id, 25000),
        actorId,
      );

      const log = await prisma.auditLog.findFirst({
        where: { entityId: result.payment.id, action: AuditAction.PAYMENT },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(actorId);
    }, 60000);
  });
});
