import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  DeliveryOrderStatus,
  DocumentType,
  PurchaseOrderStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersService (conversión a orden de entrega)', () => {
  let prisma: PrismaService;
  let service: PurchaseOrdersService;

  let actorId: string;
  let customerId: string;

  // `afterAll` los borra solo si llegaron a crearse.
  const poIds: string[] = [];
  const dooIds: string[] = [];

  const testSuffix = Date.now().toString();
  let poCounter = 0;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
      ],
      providers: [PurchaseOrdersService],
    }).compile();

    prisma = module.get(PrismaService);
    service = module.get(PurchaseOrdersService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-po-${testSuffix}@copigrafica.dev`,
        fullName: 'Test Po User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;

    const customer = await prisma.customer.create({
      data: {
        name: `Cliente Compra ${testSuffix}`,
        documentType: DocumentType.NIT,
        documentNumber: `PO-TEST-${testSuffix}`,
        phone: `3-PO-${testSuffix}`,
      },
    });
    customerId = customer.id;
    // El montaje contra una base remota no cabe en el default de 5s.
  }, 120000);

  afterAll(async () => {
    // Los borrados son secuenciales contra una base remota: el default de 5s
    // de Jest para hooks no alcanza.
    for (const id of dooIds) {
      await prisma.deliveryOrder.delete({ where: { id } }).catch(() => {});
    }
    for (const id of poIds) {
      await prisma.purchaseOrder.delete({ where: { id } }).catch(() => {});
    }
    if (customerId) {
      await prisma.customer
        .delete({ where: { id: customerId } })
        .catch(() => {});
    }
    if (actorId) {
      await prisma.profile.delete({ where: { id: actorId } }).catch(() => {});
    }
  }, 180000);

  async function createPo(
    status: PurchaseOrderStatus,
    items: unknown,
  ): Promise<string> {
    poCounter += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-TEST-${testSuffix}-${poCounter}`,
        customerId,
        issueDate: new Date(),
        items: items as never,
        status,
      },
    });
    poIds.push(po.id);
    return po.id;
  }

  // Descripciones con espacios sobrantes: es el caso real que differía entre las
  // dos rutas PO->DO y por el que se normaliza al copiar.
  const itemsWithPadding = [
    {
      description: '  Láminas  ',
      quantity: 10,
      unitPrice: 2000,
    },
    {
      description: 'Afiches ',
      quantity: 5.456,
      unitPrice: 1500,
    },
  ];

  describe('convertToDeliveryOrder', () => {
    it('rechaza una orden de compra que no está aprobada', async () => {
      const poId = await createPo(PurchaseOrderStatus.SOLICITADA, []);

      await expect(
        service.convertToDeliveryOrder(poId, actorId),
      ).rejects.toBeInstanceOf(BadRequestException);

      const created = await prisma.deliveryOrder.findMany({
        where: { purchaseOrderId: poId },
      });
      expect(created).toHaveLength(0);
    });

    it('rechaza una orden de compra cancelada', async () => {
      const poId = await createPo(PurchaseOrderStatus.CANCELADA, []);

      await expect(
        service.convertToDeliveryOrder(poId, actorId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('copia los ítems normalizando descripción y cantidades', async () => {
      const poId = await createPo(
        PurchaseOrderStatus.APROBADA,
        itemsWithPadding,
      );

      const doo = await service.convertToDeliveryOrder(poId, actorId);
      dooIds.push(doo.id);

      expect(doo.purchaseOrderId).toBe(poId);
      expect(doo.customerId).toBe(customerId);
      expect(doo.status).toBe(DeliveryOrderStatus.PENDIENTE);
      expect(doo.doNumber).toMatch(/^ENT/);

      const items = doo.items as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
      }>;
      expect(items).toHaveLength(2);
      // La descripción se copia recortada, igual que en la creación manual de
      // la orden de entrega: si no, el mismo producto queda con dos nombres
      // distintos al agrupar cantidades y al mostrar la entrega.
      expect(items[0].description).toBe('Láminas');
      expect(items[1].description).toBe('Afiches');
      // Cantidades y precios se redondean a dos decimales.
      expect(items[0].quantity).toBe(10);
      expect(items[0].unitPrice).toBe(2000);
      expect(items[1].quantity).toBe(5.46);
    });

    it('conserva el IVA (taxRate) de cada ítem al copiarlos', async () => {
      const poId = await createPo(PurchaseOrderStatus.APROBADA, [
        {
          description: 'Láminas',
          quantity: 2,
          unitPrice: 1000,
          discount: 0,
          taxRate: 19,
        },
        {
          description: 'Afiches',
          quantity: 1,
          unitPrice: 1500,
          discount: 0,
          taxRate: 0,
        },
      ]);

      const doo = await service.convertToDeliveryOrder(poId, actorId);
      dooIds.push(doo.id);

      const items = doo.items as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        taxRate?: number;
      }>;
      // El IVA debe viajar con el ítem: si se pierde aquí, la factura se genera
      // sin IVA y no cuadra con la cotización.
      expect(items[0].taxRate).toBe(19);
      expect(items[1].taxRate).toBe(0);
    });

    it('cada conversión reserva un número de orden de entrega distinto', async () => {
      const first = await service.convertToDeliveryOrder(
        await createPo(PurchaseOrderStatus.APROBADA, itemsWithPadding),
        actorId,
      );
      dooIds.push(first.id);

      const second = await service.convertToDeliveryOrder(
        await createPo(PurchaseOrderStatus.APROBADA, itemsWithPadding),
        actorId,
      );
      dooIds.push(second.id);

      expect(second.doNumber).not.toBe(first.doNumber);
    });

    it('falla si la orden de compra no existe', async () => {
      await expect(
        service.convertToDeliveryOrder(
          '00000000-0000-0000-0000-000000000000',
          actorId,
        ),
      ).rejects.toThrow();
    });
  });
});
