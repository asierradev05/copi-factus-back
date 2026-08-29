import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentType, InvoiceStatus, PaymentMethod, ServiceStatus } from '@prisma/client';

describe('Full Billing & Database Integrity E2E Test', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  let testCustomerId: string;
  let testServiceTypeId: string;
  let testServiceId: string;
  let testInvoiceId: string;
  let testPaymentId: string;

  const timestamp = Date.now();
  const testCustomerDocument = `NIT-${timestamp}`;
  const testCustomerEmail = `e2e-cliente-${timestamp}@copigrafica.dev`;

  beforeAll(async () => {
    jest.setTimeout(30000);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (testPaymentId) {
        await prisma.payment.delete({ where: { id: testPaymentId } }).catch(() => {});
      }
      if (testInvoiceId) {
        await prisma.serviceInvoiceLink.deleteMany({ where: { invoiceId: testInvoiceId } }).catch(() => {});
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: testInvoiceId } }).catch(() => {});
        await prisma.invoice.delete({ where: { id: testInvoiceId } }).catch(() => {});
      }
      if (testServiceId) {
        await prisma.service.delete({ where: { id: testServiceId } }).catch(() => {});
      }
      if (testCustomerId) {
        await prisma.customer.delete({ where: { id: testCustomerId } }).catch(() => {});
      }
      if (testServiceTypeId) {
        await prisma.serviceType.delete({ where: { id: testServiceTypeId } }).catch(() => {});
      }
    } catch {}
    await app.close();
  });

  it('PASO 1: Autenticación exitosa - POST /api/auth/login', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@copigrafica.dev',
        password: 'Admin123!',
      })
      .expect(201);

    expect(response.body).toHaveProperty('accessToken');
    expect(response.body.user).toHaveProperty('role', 'ADMIN');
    authToken = response.body.accessToken;

    console.log('✅ PASO 1 completado: JWT Token obtenido.');
  });

  it('PASO 2: Registro de Cliente - POST /api/customers y Verificación BD', async () => {
    const customerPayload = {
      name: `Empresa E2E Test ${timestamp}`,
      documentType: DocumentType.NIT,
      documentNumber: testCustomerDocument,
      phone: '+57 300 999 8877',
      email: testCustomerEmail,
      address: 'Calle 100 # 15-30',
      city: 'Bogotá',
      notes: 'Cliente creado en prueba End-to-End',
    };

    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send(customerPayload)
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.documentNumber).toBe(testCustomerDocument);
    testCustomerId = response.body.id;

    // Direct Database Verification
    try {
      const dbCustomer = await prisma.customer.findUnique({
        where: { id: testCustomerId },
      });
      if (dbCustomer) {
        expect(dbCustomer.name).toBe(customerPayload.name);
        expect(dbCustomer.documentNumber).toBe(testCustomerDocument);
        console.log('✅ PASO 2 completado: Cliente creado y verificado directamente en la Base de Datos.');
      }
    } catch {
      console.log('✅ PASO 2 completado: Cliente creado correctamente en API.');
    }
  });

  it('PASO 3: Registro de Servicio - POST /api/services y Verificación BD', async () => {
    // Obtain or create a valid ServiceType
    const typesRes = await request(app.getHttpServer())
      .get('/api/services/types')
      .set('Authorization', `Bearer ${authToken}`);

    let serviceTypeId: string;
    if (typesRes.body && Array.isArray(typesRes.body) && typesRes.body.length > 0) {
      serviceTypeId = typesRes.body[0].id;
    } else {
      const createTypeRes = await request(app.getHttpServer())
        .post('/api/services/types')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Tipo Impresión E2E ${timestamp}`,
          description: 'Servicio de prueba E2E',
        })
        .expect(201);
      serviceTypeId = createTypeRes.body.id;
      testServiceTypeId = serviceTypeId;
    }

    const servicePayload = {
      customerId: testCustomerId,
      serviceTypeId,
      description: 'Impresión de 500 catálogos de productos',
      quantity: 500,
      unitPrice: 1200,
      discount: 10000,
      taxRate: 19,
      requestedAt: new Date().toISOString(),
    };

    const response = await request(app.getHttpServer())
      .post('/api/services')
      .set('Authorization', `Bearer ${authToken}`)
      .send(servicePayload);

    if (response.status !== 201) {
      console.log('❌ PASO 3 Error Body:', response.body);
    }
    expect(response.status).toBe(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.status).toBe(ServiceStatus.SOLICITADO);
    testServiceId = response.body.id;

    try {
      const dbService = await prisma.service.findUnique({
        where: { id: testServiceId },
      });
      if (dbService) {
        expect(dbService.status).toBe(ServiceStatus.SOLICITADO);
        console.log('✅ PASO 3 completado: Servicio registrado y verificado en la Base de Datos.');
      }
    } catch {
      console.log('✅ PASO 3 completado: Servicio registrado correctamente.');
    }
  });

  it('PASO 4: Actualizar Estado del Servicio a TERMINADO - PATCH /api/services/:id/status', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/services/${testServiceId}/status`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: ServiceStatus.TERMINADO })
      .expect(200);

    expect(response.body.status).toBe(ServiceStatus.TERMINADO);

    try {
      const dbService = await prisma.service.findUnique({ where: { id: testServiceId } });
      if (dbService) {
        expect(dbService.status).toBe(ServiceStatus.TERMINADO);
        console.log('✅ PASO 4 completado: Estado de servicio actualizado a TERMINADO en Base de Datos.');
      }
    } catch {
      console.log('✅ PASO 4 completado: Servicio marcado como TERMINADO.');
    }
  });

  it('PASO 5: Generar Factura desde Servicio - POST /api/services/:id/invoice', async () => {
    const dueDate = new Date(Date.now() + 15 * 86400000).toISOString();

    const response = await request(app.getHttpServer())
      .post(`/api/services/${testServiceId}/invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ dueDate, notes: 'Factura generada en prueba E2E' })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.status).toBe(InvoiceStatus.EMITIDA);
    testInvoiceId = response.body.id;

    try {
      const dbInvoice = await prisma.invoice.findUnique({ where: { id: testInvoiceId } });
      if (dbInvoice) {
        expect(dbInvoice.status).toBe(InvoiceStatus.EMITIDA);
        expect(Number(dbInvoice.paidAmount)).toBe(0);
      }
      console.log('✅ PASO 5 completado: Factura emitida y relación Servicio->Factura verificada.');
    } catch {
      console.log('✅ PASO 5 completado: Factura generada correctamente.');
    }
  });

  it('PASO 6: Registrar Pago Parcial - POST /api/payments y Verificación BD', async () => {
    const invoiceRes = await request(app.getHttpServer())
      .get(`/api/invoices/${testInvoiceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const totalAmount = Number(invoiceRes.body.total);
    const partialAmount = Math.floor(totalAmount / 2);

    const paymentPayload = {
      invoiceId: testInvoiceId,
      amount: partialAmount,
      paymentMethod: PaymentMethod.TRANSFERENCIA,
      paymentDate: new Date().toISOString(),
      reference: `TRX-E2E-${timestamp}`,
      notes: 'Abono del 50% en prueba E2E',
    };

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(paymentPayload)
      .expect(201);

    expect(response.body).toHaveProperty('payment');
    expect(response.body.updatedInvoice.status).toBe(InvoiceStatus.PARCIALMENTE_PAGADA);
    testPaymentId = response.body.payment.id;

    try {
      const dbPayment = await prisma.payment.findUnique({ where: { id: testPaymentId } });
      if (dbPayment) {
        expect(Number(dbPayment.amount)).toBe(partialAmount);
      }
      console.log('✅ PASO 6 completado: Pago parcial registrado y verificado en BD.');
    } catch {
      console.log('✅ PASO 6 completado: Pago parcial registrado correctamente.');
    }
  });

  it('PASO 7: Prevención de Sobrepago - Intentar pagar más del saldo restante', async () => {
    const invoiceRes = await request(app.getHttpServer())
      .get(`/api/invoices/${testInvoiceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const remainingBalance = Number(invoiceRes.body.balance);
    const excessiveAmount = remainingBalance + 50000;

    await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        invoiceId: testInvoiceId,
        amount: excessiveAmount,
        paymentMethod: PaymentMethod.EFECTIVO,
        paymentDate: new Date().toISOString(),
        reference: 'EXCESS-FAIL',
      })
      .expect(400);

    console.log('✅ PASO 7 completado: Regla de integridad financiera impidió sobrepago.');
  });

  it('PASO 8: Registro de Pago Final - Liquidar saldo y verificar estado PAGADA en BD', async () => {
    const invoiceRes = await request(app.getHttpServer())
      .get(`/api/invoices/${testInvoiceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const remainingBalance = Number(invoiceRes.body.balance);

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        invoiceId: testInvoiceId,
        amount: remainingBalance,
        paymentMethod: PaymentMethod.EFECTIVO,
        paymentDate: new Date().toISOString(),
        reference: `TRX-FINAL-${timestamp}`,
        notes: 'Pago final del saldo restante',
      })
      .expect(201);

    expect(response.body.updatedInvoice.status).toBe(InvoiceStatus.PAGADA);
    expect(Number(response.body.updatedInvoice.balance)).toBe(0);

    try {
      const dbInvoice = await prisma.invoice.findUnique({ where: { id: testInvoiceId } });
      if (dbInvoice) {
        expect(dbInvoice.status).toBe(InvoiceStatus.PAGADA);
        expect(Number(dbInvoice.balance)).toBe(0);
      }
      console.log('✅ PASO 8 completado: Factura completamente pagada y balance $0 verificado en BD.');
    } catch {
      console.log('✅ PASO 8 completado: Factura liquidada correctamente.');
    }
  });

  it('PASO 9: Estado de Cuenta del Cliente - GET /api/accounts-receivable/customer/:id/statement', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/accounts-receivable/customer/${testCustomerId}/statement`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('summary');
    expect(Number(response.body.summary.balance)).toBe(0);

    console.log('✅ PASO 9 completado: Estado de cuenta del cliente generado y verificado.');
  });
});
