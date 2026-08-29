import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DocumentType,
  InvoiceStatus,
  PaymentMethod,
  ServiceStatus,
  UserRole,
} from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding Copigrafica Sierra DEV data...');

  await prisma.auditLog.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.serviceInvoiceLink.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.service.deleteMany();
  await prisma.product.deleteMany();
  await prisma.serviceType.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.companySettings.deleteMany();

  const admin = await prisma.profile.create({
    data: {
      email: 'admin@copigrafica.dev',
      fullName: 'Administrador DEV',
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  const facturador = await prisma.profile.create({
    data: {
      email: 'facturador@copigrafica.dev',
      fullName: 'Facturador DEV',
      role: UserRole.FACTURADOR,
      isActive: true,
    },
  });

  const consulta = await prisma.profile.create({
    data: {
      email: 'consulta@copigrafica.dev',
      fullName: 'Consulta DEV',
      role: UserRole.CONSULTA,
      isActive: true,
    },
  });

  await prisma.companySettings.create({
    data: {
      id: 'default',
      name: 'Copigrafica Sierra',
      legalName: 'Copigrafica Sierra S.A.S.',
      taxId: '900123456-1',
      address: 'Calle 10 # 5-20, Centro',
      phone: '+57 300 123 4567',
      email: 'contacto@copigrafica.dev',
      city: 'Bogotá',
      invoicePrefix: 'FAC',
      invoiceNextNumber: 1001,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      name: 'Cliente Demo DEV',
      documentType: DocumentType.NIT,
      documentNumber: '900555123-4',
      phone: '+57 310 987 6543',
      email: 'cliente.demo@example.com',
      address: 'Carrera 7 # 45-10',
      city: 'Medellín',
      notes: '[DEV] Cliente de demostración para pruebas',
    },
  });

  const serviceTypes = await Promise.all([
    prisma.serviceType.create({
      data: {
        name: 'Impresión Digital',
        description: '[DEV] Impresiones a color y B/N',
      },
    }),
    prisma.serviceType.create({
      data: {
        name: 'Encuadernación',
        description: '[DEV] Encuadernación espiral y tapa dura',
      },
    }),
    prisma.serviceType.create({
      data: {
        name: 'Diseño Gráfico',
        description: '[DEV] Diseño de logos y material publicitario',
      },
    }),
  ]);

  const products = await Promise.all([
    prisma.product.create({
      data: {
        code: 'PAPEL-A4',
        name: 'Resma Papel A4',
        description: '[DEV] Resma 500 hojas',
        unitPrice: 18500,
        taxRate: 19,
      },
    }),
    prisma.product.create({
      data: {
        code: 'TONER-BK',
        name: 'Tóner Negro',
        description: '[DEV] Cartucho tóner negro',
        unitPrice: 95000,
        taxRate: 19,
      },
    }),
  ]);

  const service1 = await prisma.service.create({
    data: {
      customerId: customer.id,
      serviceTypeId: serviceTypes[0].id,
      description: '[DEV] 500 volantes full color tamaño carta',
      quantity: 500,
      unitPrice: 350,
      discount: 0,
      taxRate: 19,
      subtotal: 175000,
      total: 208250,
      requestedAt: new Date('2026-01-15'),
      deliveryDate: new Date('2026-01-20'),
      status: ServiceStatus.FACTURADO,
      createdById: facturador.id,
      notes: '[DEV] Servicio demo facturado',
    },
  });

  const service2 = await prisma.service.create({
    data: {
      customerId: customer.id,
      serviceTypeId: serviceTypes[1].id,
      description: '[DEV] Encuadernación de 50 informes',
      quantity: 50,
      unitPrice: 2500,
      discount: 5000,
      taxRate: 19,
      subtotal: 120000,
      total: 142800,
      requestedAt: new Date('2026-02-01'),
      status: ServiceStatus.TERMINADO,
      createdById: facturador.id,
      notes: '[DEV] Servicio demo pendiente de facturar',
    },
  });

  const invoice1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'FAC-001000',
      customerId: customer.id,
      issueDate: new Date('2026-01-21'),
      dueDate: new Date('2026-02-20'),
      subtotal: 175000,
      discountTotal: 0,
      taxTotal: 33250,
      total: 208250,
      paidAmount: 208250,
      balance: 0,
      status: InvoiceStatus.PAGADA,
      notes: '[DEV] Factura demo pagada completamente',
      createdById: facturador.id,
      items: {
        create: {
          description: 'Impresión Digital: 500 volantes full color',
          quantity: 500,
          unitPrice: 350,
          discount: 0,
          taxRate: 19,
          subtotal: 175000,
          taxAmount: 33250,
          total: 208250,
        },
      },
      serviceLinks: {
        create: { serviceId: service1.id },
      },
      payments: {
        create: {
          customerId: customer.id,
          amount: 208250,
          paymentMethod: PaymentMethod.TRANSFERENCIA,
          paymentDate: new Date('2026-01-25'),
          reference: 'TRX-DEV-001',
          notes: '[DEV] Pago completo demo',
          createdById: facturador.id,
        },
      },
    },
  });

  const invoice2 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'FAC-001001',
      customerId: customer.id,
      issueDate: new Date('2026-02-10'),
      dueDate: new Date('2026-03-10'),
      subtotal: 18500,
      discountTotal: 0,
      taxTotal: 3515,
      total: 22015,
      paidAmount: 10000,
      balance: 12015,
      status: InvoiceStatus.PARCIALMENTE_PAGADA,
      notes: '[DEV] Factura demo con pago parcial',
      createdById: facturador.id,
      items: {
        create: {
          productId: products[0].id,
          description: 'Resma Papel A4',
          quantity: 1,
          unitPrice: 18500,
          discount: 0,
          taxRate: 19,
          subtotal: 18500,
          taxAmount: 3515,
          total: 22015,
        },
      },
      payments: {
        create: {
          customerId: customer.id,
          amount: 10000,
          paymentMethod: PaymentMethod.EFECTIVO,
          paymentDate: new Date('2026-02-12'),
          reference: 'REC-DEV-001',
          notes: '[DEV] Abono parcial demo',
          createdById: facturador.id,
        },
      },
    },
  });

  const invoice3 = await prisma.invoice.create({
    data: {
      customerId: customer.id,
      dueDate: new Date('2026-03-15'),
      subtotal: 95000,
      discountTotal: 0,
      taxTotal: 18050,
      total: 113050,
      paidAmount: 0,
      balance: 113050,
      status: InvoiceStatus.BORRADOR,
      notes: '[DEV] Factura borrador demo',
      createdById: facturador.id,
      items: {
        create: {
          productId: products[1].id,
          description: 'Tóner Negro',
          quantity: 1,
          unitPrice: 95000,
          discount: 0,
          taxRate: 19,
          subtotal: 95000,
          taxAmount: 18050,
          total: 113050,
        },
      },
    },
  });

  console.log('✅ DEV seed completed:');
  console.log(`   Admin:      admin@copigrafica.dev / Admin123! (DEV_PASSWORD)`);
  console.log(`   Facturador: facturador@copigrafica.dev / Admin123!`);
  console.log(`   Consulta:   consulta@copigrafica.dev / Admin123!`);
  console.log(`   Customer:   ${customer.name} (${customer.documentNumber})`);
  console.log(`   Invoices:   ${invoice1.invoiceNumber}, ${invoice2.invoiceNumber}, borrador ${invoice3.id}`);
  console.log(`   Service pending invoice: ${service2.description}`);
  console.log(`   Profiles created: admin=${admin.id}, facturador=${facturador.id}, consulta=${consulta.id}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
