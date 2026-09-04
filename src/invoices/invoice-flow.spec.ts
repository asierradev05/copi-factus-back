import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  DocumentType,
  InvoiceStatus,
  PaymentMethod,
  ServiceStatus,
  UserRole,
} from '@prisma/client';
import type { Invoice, Payment, Service } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../common/email/email.module';
import { CustomersService } from '../customers/customers.service';
import { ServicesService } from '../services/services.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';

describe('Invoice Flow Integration', () => {
  let prisma: PrismaService;
  let customersService: CustomersService;
  let servicesService: ServicesService;
  let invoicesService: InvoicesService;
  let paymentsService: PaymentsService;

  let actorId: string;
  let serviceTypeId: string;
  let customerId: string;
  let serviceId: string;
  let invoiceId: string;

  const testSuffix = Date.now().toString();

  type RegisteredPayment = Payment & { updatedInvoice: Invoice };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        EmailModule,
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
        email: `test-flow-${testSuffix}@copigrafica.dev`,
        fullName: 'Test Flow User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;

    const serviceType = await prisma.serviceType.create({
      data: {
        name: `Test Type ${testSuffix}`,
        description: '[TEST] Integration test service type',
      },
    });
    serviceTypeId = serviceType.id;

    const settings = await prisma.companySettings.findUnique({
      where: { id: 'default' },
    });
    if (!settings) {
      await prisma.companySettings.create({
        data: {
          id: 'default',
          name: 'Test Company',
          legalName: 'Test Company S.A.S.',
          invoicePrefix: 'TST',
          invoiceNextNumber: 9000,
        },
      });
    }
  });

  afterAll(async () => {
    if (invoiceId) {
      await prisma.payment.deleteMany({ where: { invoiceId } });
      await prisma.serviceInvoiceLink.deleteMany({
        where: { invoiceId },
      });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId } });
      await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {});
    }
    if (serviceId) {
      await prisma.service.delete({ where: { id: serviceId } }).catch(() => {});
    }
    if (customerId) {
      await prisma.customer
        .delete({ where: { id: customerId } })
        .catch(() => {});
    }
    if (serviceTypeId) {
      await prisma.serviceType
        .delete({ where: { id: serviceTypeId } })
        .catch(() => {});
    }
    if (actorId) {
      await prisma.auditLog.deleteMany({ where: { userId: actorId } });
      await prisma.profile.delete({ where: { id: actorId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('should complete full billing flow: customer -> service -> finish -> invoice -> partial payment -> full payment', async () => {
    const customer = await customersService.create(
      {
        name: `Cliente Test ${testSuffix}`,
        documentType: DocumentType.CC,
        documentNumber: `TEST-${testSuffix}`,
        phone: `300-TEST-${testSuffix}`,
        email: `cliente-${testSuffix}@test.com`,
      },
      actorId,
    );
    customerId = customer.id;
    expect(customer.id).toBeDefined();

    const service = (await servicesService.create(
      {
        customerId: customer.id,
        serviceTypeId,
        description: 'Impresión de 100 tarjetas de presentación',
        quantity: 100,
        unitPrice: 500,
        discount: 0,
        taxRate: 19,
        requestedAt: new Date().toISOString(),
      },
      actorId,
    )) as Service;
    serviceId = service.id;
    expect(service.status).toBe(ServiceStatus.SOLICITADO);
    expect(service.total.toNumber()).toBe(59500);

    const finished = (await servicesService.updateStatus(
      service.id,
      { status: ServiceStatus.TERMINADO },
      actorId,
    )) as Service;
    expect(finished.status).toBe(ServiceStatus.TERMINADO);

    const invoice = (await servicesService.invoiceFromService(
      service.id,
      { dueDate: new Date(Date.now() + 30 * 86400000).toISOString() },
      actorId,
    )) as Invoice;
    invoiceId = invoice.id;
    expect(invoice.status).toBe(InvoiceStatus.EMITIDA);
    expect(invoice.invoiceNumber).toBeTruthy();
    expect(invoice.balance.toNumber()).toBe(59500);

    const updatedService = (await servicesService.findOne(
      service.id,
    )) as Service;
    expect(updatedService.status).toBe(ServiceStatus.FACTURADO);

    const partialAmount = 30000;
    const partialPayment = (await paymentsService.register(
      {
        invoiceId: invoice.id,
        amount: partialAmount,
        paymentMethod: PaymentMethod.EFECTIVO,
        paymentDate: new Date().toISOString(),
        reference: 'TEST-PARTIAL',
      },
      actorId,
    )) as RegisteredPayment;
    expect(partialPayment.updatedInvoice.status).toBe(
      InvoiceStatus.PARCIALMENTE_PAGADA,
    );
    expect(partialPayment.updatedInvoice.paidAmount.toNumber()).toBe(
      partialAmount,
    );
    expect(partialPayment.updatedInvoice.balance.toNumber()).toBe(29500);

    const remainingBalance = partialPayment.updatedInvoice.balance.toNumber();
    const fullPayment = (await paymentsService.register(
      {
        invoiceId: invoice.id,
        amount: remainingBalance,
        paymentMethod: PaymentMethod.TRANSFERENCIA,
        paymentDate: new Date().toISOString(),
        reference: 'TEST-FULL',
      },
      actorId,
    )) as RegisteredPayment;
    expect(fullPayment.updatedInvoice.status).toBe(InvoiceStatus.PAGADA);
    expect(fullPayment.updatedInvoice.balance.toNumber()).toBe(0);
    expect(fullPayment.updatedInvoice.paidAmount.toNumber()).toBe(59500);

    const finalInvoice = (await invoicesService.findOne(invoice.id)) as Invoice;
    expect(finalInvoice.status).toBe(InvoiceStatus.PAGADA);
    expect(finalInvoice.balance.toNumber()).toBe(0);
  }, 30000);
});
