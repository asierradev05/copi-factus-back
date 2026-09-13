import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DeliveryOrderStatus, DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { DeliveryOrdersService } from './delivery-orders.service';

describe('DeliveryOrdersService (entregas parciales)', () => {
  let prisma: PrismaService;
  let service: DeliveryOrdersService;

  let actorId: string;
  let customerId: string;
  let dooId: string;
  let invoiceId: string;
  let dooCounter = 0;

  const testSuffix = Date.now().toString();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
      ],
      providers: [DeliveryOrdersService],
    }).compile();

    prisma = module.get(PrismaService);
    service = module.get(DeliveryOrdersService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-doo-${testSuffix}@copigrafica.dev`,
        fullName: 'Test Doo User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;

    const customer = await prisma.customer.create({
      data: {
        name: `Cliente Entrega ${testSuffix}`,
        documentType: DocumentType.NIT,
        documentNumber: `DO-TEST-${testSuffix}`,
        phone: `3-DO-${testSuffix}`,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (invoiceId) {
      await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {});
    }
    if (dooId) {
      await prisma.deliveryOrder
        .delete({ where: { id: dooId } })
        .catch(() => {});
    }
    if (customerId) {
      await prisma.customer
        .delete({ where: { id: customerId } })
        .catch(() => {});
    }
    if (actorId) {
      await prisma.profile.delete({ where: { id: actorId } }).catch(() => {});
    }
  });

  const baseItems = [
    { description: 'Láminas', quantity: 10, unitPrice: 2000, taxRate: 19 },
    { description: 'Afiches', quantity: 5, unitPrice: 1500, taxRate: 19 },
  ];

  async function createDoo() {
    if (dooId) {
      const prev = await prisma.deliveryOrder
        .findUnique({ where: { id: dooId }, select: { invoiceId: true } })
        .catch(() => null);
      if (prev?.invoiceId) {
        await prisma.invoice
          .delete({ where: { id: prev.invoiceId } })
          .catch(() => {});
      }
      await prisma.deliveryOrder
        .delete({ where: { id: dooId } })
        .catch(() => {});
    }
    dooCounter += 1;
    const doo = await prisma.deliveryOrder.create({
      data: {
        doNumber: `ENT-TEST-${testSuffix}-${dooCounter}`,
        customerId,
        scheduledAt: new Date(),
        status: DeliveryOrderStatus.PENDIENTE,
        items: baseItems,
      },
    });
    return doo.id;
  }

  describe('registerDelivery', () => {
    it('crea una entrega parcial y pasa la orden a PARCIALMENTE_ENTREGADA', async () => {
      dooId = await createDoo();

      const updated = await service.registerDelivery(
        dooId,
        {
          items: [{ description: 'Láminas', quantity: 4 }],
          notes: 'Primer lote',
        },
        actorId,
      );

      expect(updated.status).toBe(DeliveryOrderStatus.PARCIALMENTE_ENTREGADA);
      expect(updated.deliveredAt).toBeNull();

      const rows = await prisma.deliveryOrderDelivery.findMany({
        where: { deliveryOrderId: dooId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].notes).toBe('Primer lote');
      const items = rows[0].items as Array<{
        description: string;
        quantity: number;
      }>;
      expect(items[0]).toMatchObject({ description: 'Láminas', quantity: 4 });
    });

    it('completa la entrega en el segundo despacho y pasa a ENTREGADA', async () => {
      const updated = await service.registerDelivery(
        dooId,
        {
          items: [
            { description: 'Láminas', quantity: 6 },
            { description: 'Afiches', quantity: 5 },
          ],
        },
        actorId,
      );

      expect(updated.status).toBe(DeliveryOrderStatus.ENTREGADA);
      expect(updated.deliveredAt).toBeInstanceOf(Date);
    });

    it('rechaza una sobre-entrega sin crear fila', async () => {
      dooId = await createDoo();
      await prisma.deliveryOrder.update({
        where: { id: dooId },
        data: { status: DeliveryOrderStatus.PARCIALMENTE_ENTREGADA },
      });

      await expect(
        service.registerDelivery(
          dooId,
          { items: [{ description: 'Láminas', quantity: 11 }] },
          actorId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const rows = await prisma.deliveryOrderDelivery.findMany({
        where: { deliveryOrderId: dooId },
      });
      expect(rows).toHaveLength(0);
    });

    it('rechaza una descripción fuera de los ítems de la orden', async () => {
      await expect(
        service.registerDelivery(
          dooId,
          { items: [{ description: 'Obsequio', quantity: 1 }] },
          actorId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza entregas en una orden cancelada', async () => {
      dooId = await createDoo();
      await prisma.deliveryOrder.update({
        where: { id: dooId },
        data: { status: DeliveryOrderStatus.CANCELADA },
      });

      await expect(
        service.registerDelivery(
          dooId,
          { items: [{ description: 'Láminas', quantity: 1 }] },
          actorId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('markFullyDelivered', () => {
    it('marca PENDIENTE sin entregas con el remanente completo', async () => {
      dooId = await createDoo();

      const updated = await service.markFullyDelivered(dooId, actorId);

      expect(updated.status).toBe(DeliveryOrderStatus.ENTREGADA);
      expect(updated.deliveredAt).toBeInstanceOf(Date);

      const rows = await prisma.deliveryOrderDelivery.findMany({
        where: { deliveryOrderId: dooId },
      });
      expect(rows).toHaveLength(1);
      const items = rows[0].items as Array<{
        description: string;
        quantity: number;
      }>;
      expect(items).toHaveLength(2);
      expect(items.find((i) => i.description === 'Láminas')?.quantity).toBe(10);
    });

    it('completa una orden parcial con el remanente', async () => {
      dooId = await createDoo();
      await service.registerDelivery(
        dooId,
        { items: [{ description: 'Láminas', quantity: 4 }] },
        actorId,
      );

      const updated = await service.markFullyDelivered(dooId, actorId);

      expect(updated.status).toBe(DeliveryOrderStatus.ENTREGADA);

      const rows = await prisma.deliveryOrderDelivery.findMany({
        where: { deliveryOrderId: dooId },
      });
      expect(rows).toHaveLength(2);
      const last = rows[rows.length - 1];
      const items = last.items as Array<{
        description: string;
        quantity: number;
      }>;
      expect(items.find((i) => i.description === 'Láminas')?.quantity).toBe(6);
      expect(items.find((i) => i.description === 'Afiches')?.quantity).toBe(5);
    });

    it('es idempotente sobre una orden ya entregada', async () => {
      dooId = await createDoo();
      await service.markFullyDelivered(dooId, actorId);

      const before = await prisma.deliveryOrderDelivery.count({
        where: { deliveryOrderId: dooId },
      });

      const updated = await service.markFullyDelivered(dooId, actorId);
      expect(updated.status).toBe(DeliveryOrderStatus.ENTREGADA);

      const after = await prisma.deliveryOrderDelivery.count({
        where: { deliveryOrderId: dooId },
      });
      expect(after).toBe(before);
    });

    it('rechaza completar una orden cancelada', async () => {
      dooId = await createDoo();
      await prisma.deliveryOrder.update({
        where: { id: dooId },
        data: { status: DeliveryOrderStatus.CANCELADA },
      });

      await expect(
        service.markFullyDelivered(dooId, actorId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('syncInvoiceFromDeliveries', () => {
    it('rechaza facturar sin entregas registradas', async () => {
      dooId = await createDoo();

      await expect(
        service.syncInvoiceFromDeliveries(dooId, actorId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('crea una factura BORRADOR con lo entregado en el primer despacho', async () => {
      dooId = await createDoo();
      await service.registerDelivery(
        dooId,
        { items: [{ description: 'Láminas', quantity: 4 }] },
        actorId,
      );

      const invoice = await service.syncInvoiceFromDeliveries(dooId, actorId);

      expect(invoice.id).toBeTruthy();
      expect(invoice.status).toBe('BORRADOR');
      expect(invoice.items).toHaveLength(1);
      const line = invoice.items[0];
      expect(line.description).toBe('Láminas');
      expect(Number(line.quantity)).toBe(4);
      expect(Number(line.total)).toBeCloseTo(4 * 2000 * 1.19, 2);

      const linked = await prisma.deliveryOrder.findUnique({
        where: { id: dooId },
        select: { invoiceId: true },
      });
      expect(linked?.invoiceId).toBe(invoice.id);
    });

    it('crece una factura BORRADOR con los despachos siguientes', async () => {
      await service.registerDelivery(
        dooId,
        {
          items: [
            { description: 'Láminas', quantity: 6 },
            { description: 'Afiches', quantity: 5 },
          ],
        },
        actorId,
      );

      const linked = await prisma.deliveryOrder.findUnique({
        where: { id: dooId },
        select: { invoiceId: true },
      });

      const invoice = await service.syncInvoiceFromDeliveries(dooId, actorId);

      expect(invoice.id).toBe(linked?.invoiceId);
      expect(invoice.items).toHaveLength(2);
      const lineAfiches = invoice.items.find(
        (i) => i.description === 'Afiches',
      );
      expect(Number(lineAfiches?.quantity)).toBe(5);
      const lineLaminas = invoice.items.find(
        (i) => i.description === 'Láminas',
      );
      expect(Number(lineLaminas?.quantity)).toBe(10);
      expect(Number(invoice.balance)).toBeCloseTo(
        10 * 2000 * 1.19 + 5 * 1500 * 1.19,
        2,
      );
    });

    it('no modifica una factura ya emitida', async () => {
      dooId = await createDoo();
      await service.registerDelivery(
        dooId,
        { items: [{ description: 'Láminas', quantity: 4 }] },
        actorId,
      );
      const draft = await service.syncInvoiceFromDeliveries(dooId, actorId);
      await prisma.invoice.update({
        where: { id: draft.id },
        data: { status: 'EMITIDA' },
      });

      await service.registerDelivery(
        dooId,
        { items: [{ description: 'Láminas', quantity: 6 }] },
        actorId,
      );
      const invoice = await service.syncInvoiceFromDeliveries(dooId, actorId);

      expect(invoice.status).toBe('EMITIDA');
      expect(Number(invoice.items[0].quantity)).toBe(4);
    });

    it('rechaza facturar una orden cancelada', async () => {
      dooId = await createDoo();
      await prisma.deliveryOrder.update({
        where: { id: dooId },
        data: { status: DeliveryOrderStatus.CANCELADA },
      });

      await expect(
        service.syncInvoiceFromDeliveries(dooId, actorId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateStatus guard con remanente', () => {
    it('bloquea marcar ENTREGADA manualmente si hay remanente', async () => {
      dooId = await createDoo();
      await service.registerDelivery(
        dooId,
        { items: [{ description: 'Láminas', quantity: 4 }] },
        actorId,
      );

      await expect(
        service.updateStatus(
          dooId,
          { status: DeliveryOrderStatus.ENTREGADA },
          actorId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('permite ENTREGADA manual sin entregas registradas', async () => {
      dooId = await createDoo();

      const updated = await service.updateStatus(
        dooId,
        { status: DeliveryOrderStatus.ENTREGADA },
        actorId,
      );

      expect(updated.status).toBe(DeliveryOrderStatus.ENTREGADA);
    });

    it('permite ENTREGADA manual cuando el plan ya está completo', async () => {
      dooId = await createDoo();
      await service.markFullyDelivered(dooId, actorId);
      await prisma.deliveryOrder.update({
        where: { id: dooId },
        data: { status: DeliveryOrderStatus.PARCIALMENTE_ENTREGADA },
      });

      const updated = await service.updateStatus(
        dooId,
        { status: DeliveryOrderStatus.ENTREGADA },
        actorId,
      );

      expect(updated.status).toBe(DeliveryOrderStatus.ENTREGADA);
    });
  });
});
