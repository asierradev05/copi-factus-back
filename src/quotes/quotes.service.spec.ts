import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../common/email/email.module';
import { QuotesService } from './quotes.service';

describe('QuotesService (envío de cotización)', () => {
  let prisma: PrismaService;
  let service: QuotesService;

  let actorId: string;
  let customerId: string;
  let quoteId: string;

  const testSuffix = Date.now().toString();
  const email = `cliente-quote-${testSuffix}@copigrafica.dev`;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        EmailModule,
      ],
      providers: [QuotesService],
    }).compile();

    prisma = module.get(PrismaService);
    service = module.get(QuotesService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-quote-email-${testSuffix}@copigrafica.dev`,
        fullName: 'Test Quote Email User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;

    const customer = await prisma.customer.create({
      data: {
        name: `Cliente Cotización ${testSuffix}`,
        documentType: DocumentType.NIT,
        documentNumber: `QTE-TEST-${testSuffix}`,
        phone: `3-QT-${testSuffix}`,
        email,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (quoteId) {
      await prisma.quote.delete({ where: { id: quoteId } }).catch(() => {});
    }
    quoteId = '';
    if (customerId) {
      await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    }
    customerId = '';
    if (actorId) {
      await prisma.profile.delete({ where: { id: actorId } }).catch(() => {});
    }
    actorId = '';
  });

  it('envía la cotización por correo y marca emailSentAt', async () => {
    const created = await service.create(
      {
        customerId,
        issueDate: new Date().toISOString(),
        validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        notes: 'Cotización de prueba.',
        items: [
          {
            description: 'Láminas adhesivas x10',
            quantity: 10,
            unitPrice: 2000,
            taxRate: 19,
          },
        ],
      },
      actorId,
    );
    quoteId = created.id;

    const result = await service.sendEmail(quoteId, {}, actorId);

    expect(result.success).toBe(true);
    expect(result.to).toBe(email);
    expect(result.simulated).toBe(true);

    const persisted = await prisma.quote.findUnique({ where: { id: quoteId } });
    expect(persisted?.emailSentAt).toBeInstanceOf(Date);
  });
});