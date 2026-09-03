import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SupabaseService } from '../common/supabase/supabase.service';
import { InvoiceUploadsService } from './invoice-uploads.service';

describe('InvoiceUploadsService (customer association)', () => {
  let prisma: PrismaService;
  let service: InvoiceUploadsService;

  let actorId: string;
  let customerId: string;
  let uploadId: string;
  let uploadId2: string;

  const testSuffix = Date.now().toString();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
      ],
      providers: [SupabaseService, InvoiceUploadsService],
    }).compile();

    prisma = module.get(PrismaService);
    service = module.get(InvoiceUploadsService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-upload-${testSuffix}@copigrafica.dev`,
        fullName: 'Test Upload User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;

    const customer = await prisma.customer.create({
      data: {
        name: `Cliente Import ${testSuffix}`,
        documentType: DocumentType.NIT,
        documentNumber: `IMP-${testSuffix}`,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    for (const id of [uploadId, uploadId2]) {
      if (id) {
        await prisma.invoiceUpload.delete({ where: { id } }).catch(() => {});
      }
    }
    if (customerId) {
      await prisma.customer
        .delete({ where: { id: customerId } })
        .catch(() => {});
    }
    if (actorId) {
      await prisma.auditLog.deleteMany({ where: { userId: actorId } });
      await prisma.profile.delete({ where: { id: actorId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('findOne returns the associated customer', async () => {
    const upload = await prisma.invoiceUpload.create({
      data: {
        fileName: `factura-${testSuffix}.pdf`,
        filePath: `invoice-pdfs/${testSuffix}.pdf`,
        fileSize: 1000,
        extractedNit: `IMP-${testSuffix}`,
        uploadedById: actorId,
        customerId,
      },
    });
    uploadId = upload.id;

    const found = await service.findOne(upload.id);
    expect(found).toBeTruthy();
    expect(found?.customerId).toBe(customerId);
    expect(found?.customer).toBeDefined();
    expect(found?.customer?.id).toBe(customerId);
    expect(found?.customer?.name).toBe(`Cliente Import ${testSuffix}`);
  });

  it('findAll returns the associated customer', async () => {
    const result = await service.findAll(1, 20);
    expect(result.meta.total).toBeGreaterThanOrEqual(1);
    const found = result.data.find((u) => u.id === uploadId);
    expect(found).toBeDefined();
    expect(found?.customer?.id).toBe(customerId);
    expect(found?.customer?.name).toBe(`Cliente Import ${testSuffix}`);
  });

  it('update associates a customer to an upload', async () => {
    const upload = await prisma.invoiceUpload.create({
      data: {
        fileName: `factura-${testSuffix}-2.pdf`,
        filePath: `invoice-pdfs/${testSuffix}-2.pdf`,
        fileSize: 1000,
        extractedNit: `IMP-${testSuffix}`,
        uploadedById: actorId,
      },
    });
    uploadId2 = upload.id;

    const updated = await service.update(upload.id, customerId, actorId);
    expect(updated).toBeTruthy();
    expect(updated?.customerId).toBe(customerId);
    expect(updated?.customer?.id).toBe(customerId);

    const found = await service.findOne(upload.id);
    expect(found?.customer?.id).toBe(customerId);
  });
});
