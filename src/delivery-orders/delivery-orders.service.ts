import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DeliveryOrderStatus,
  InvoiceStatus,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/utils/document-sequence.util';
import { toDecimal } from '../common/utils/money.util';
import {
  CreateDeliveryOrderDto,
  FilterDeliveryOrderDto,
  RegisterDeliveryDto,
  UpdateDeliveryOrderStatusDto,
} from './dto/delivery-order.dto';

@Injectable()
export class DeliveryOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: FilterDeliveryOrderDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.DeliveryOrderWhereInput = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.scheduledAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to
          ? { lte: new Date(new Date(query.to).setHours(23, 59, 59)) }
          : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.deliveryOrder.findMany({
        where,
        include: { customer: true, invoice: true, purchaseOrder: true },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.deliveryOrder.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const doo = await this.prisma.deliveryOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        invoice: true,
        purchaseOrder: true,
        deliveries: { orderBy: { deliveredAt: 'asc' } },
      },
    });
    if (!doo) {
      throw new NotFoundException('La orden de entrega no fue encontrada.');
    }
    return doo;
  }

  private normalizeDeliveryItem(item: {
    description: string;
    quantity: number;
    unitPrice?: number;
    taxRate?: number;
  }) {
    return {
      description: item.description.trim(),
      quantity: Number(Number(item.quantity).toFixed(2)),
      unitPrice: item.unitPrice ? Number(Number(item.unitPrice).toFixed(2)) : 0,
      taxRate: item.taxRate ? Number(Number(item.taxRate).toFixed(2)) : 0,
    };
  }

  private sumQuantities(
    items: Array<{ description: string; quantity: number }>,
  ) {
    const map = new Map<string, number>();
    for (const it of items) {
      const key = it.description.trim().toLowerCase();
      map.set(key, (map.get(key) ?? 0) + Number(it.quantity));
    }
    return map;
  }

  private aggregateDeliveries(
    deliveries: Array<{ items: Prisma.JsonValue }>,
  ): Array<{
    description: string;
    quantity: number;
    unitPrice?: number;
    taxRate?: number;
  }> {
    const lines: Array<{
      description: string;
      quantity: number;
      unitPrice?: number;
      taxRate?: number;
    }> = [];
    for (const d of deliveries) {
      lines.push(
        ...(d.items as Prisma.InputJsonValue as Array<{
          description: string;
          quantity: number;
          unitPrice?: number;
          taxRate?: number;
        }>),
      );
    }
    return lines;
  }

  async create(dto: CreateDeliveryOrderDto, userId: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'La orden de entrega debe tener al menos un ítem.',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new BadRequestException('El cliente seleccionado no existe.');
    }

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: dto.purchaseOrderId },
    });
    if (!po) {
      throw new BadRequestException(
        'La orden de compra seleccionada no existe.',
      );
    }
    if (po.status !== PurchaseOrderStatus.APROBADA) {
      throw new BadRequestException(
        'La orden de compra debe estar aprobada antes de crear la orden de entrega.',
      );
    }

    const items = dto.items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity.toFixed(2)),
      unitPrice: item.unitPrice ? Number(item.unitPrice.toFixed(2)) : 0,
    }));

    const doNumber = await this.prisma.$transaction((tx) =>
      nextDocumentNumber(tx, 'delivery-order', 'ENT'),
    );

    const doo = await this.prisma.deliveryOrder.create({
      data: {
        doNumber,
        customerId: dto.customerId,
        purchaseOrderId: dto.purchaseOrderId,
        invoiceId: dto.invoiceId,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
        items: items,
        notes: dto.notes?.trim(),
        createdById: userId,
      },
      include: { customer: true, invoice: true, purchaseOrder: true },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'DeliveryOrder',
        entityId: doo.id,
        newValue: { doNumber },
      })
      .catch(() => {});

    return doo;
  }

  async updateStatus(
    id: string,
    dto: UpdateDeliveryOrderStatusDto,
    userId: string,
  ) {
    const current = await this.findOne(id);

    if (current.status === DeliveryOrderStatus.CANCELADA) {
      throw new BadRequestException('La orden de entrega ya está cancelada.');
    }

    if (dto.status === DeliveryOrderStatus.ENTREGADA) {
      const rows = await this.prisma.deliveryOrderDelivery.findMany({
        where: { deliveryOrderId: id },
      });
      if (rows.length > 0) {
        const planned = this.sumQuantities(
          current.items as Prisma.InputJsonValue as Array<{
            description: string;
            quantity: number;
          }>,
        );
        const delivered = this.sumQuantities(this.aggregateDeliveries(rows));
        const hasRemaining = [...planned.entries()].some(
          ([desc, qty]) => (delivered.get(desc) ?? 0) < qty,
        );
        if (hasRemaining) {
          throw new BadRequestException(
            'Hay entregas pendientes. Use "Marcar entrega total" para completar la orden.',
          );
        }
      }
    }

    const doo = await this.prisma.deliveryOrder.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === DeliveryOrderStatus.ENTREGADA
          ? { deliveredAt: new Date() }
          : {}),
      },
      include: { customer: true, invoice: true, purchaseOrder: true },
    });

    await this.audit
      .log({
        userId,
        action:
          dto.status === DeliveryOrderStatus.CANCELADA
            ? AuditAction.CANCEL
            : AuditAction.UPDATE,
        entityType: 'DeliveryOrder',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: dto.status, deliveredAt: doo.deliveredAt },
      })
      .catch(() => {});

    return doo;
  }

  async registerDelivery(id: string, dto: RegisterDeliveryDto, userId: string) {
    const doo = await this.findOne(id);
    if (doo.status === DeliveryOrderStatus.CANCELADA) {
      throw new BadRequestException(
        'No se pueden registrar entregas de una orden cancelada.',
      );
    }
    if (doo.status === DeliveryOrderStatus.ENTREGADA) {
      throw new BadRequestException(
        'La orden de entrega ya está totalmente entregada.',
      );
    }

    const plannedItems = doo.items as Prisma.InputJsonValue as Array<{
      description: string;
      quantity: number;
    }>;
    const planned = this.sumQuantities(plannedItems);
    const deliveredRows = await this.prisma.deliveryOrderDelivery.findMany({
      where: { deliveryOrderId: id },
    });
    const delivered = this.sumQuantities(
      this.aggregateDeliveries(deliveredRows),
    );

    const items = dto.items.map((it) => this.normalizeDeliveryItem(it));
    const unknown = items.find(
      (i) => !planned.has(i.description.trim().toLowerCase()),
    );
    if (unknown) {
      throw new BadRequestException(
        `"${unknown.description}" no está en los ítems de la orden.`,
      );
    }
    const normalized = this.sumQuantities(items);
    for (const [desc, qty] of normalized) {
      const remaining = (planned.get(desc) ?? 0) - (delivered.get(desc) ?? 0);
      if (qty > remaining) {
        throw new BadRequestException(
          `La cantidad entregada de "${desc}" supera lo planeado.`,
        );
      }
    }

    const delivery = await this.prisma.deliveryOrderDelivery.create({
      data: {
        deliveryOrderId: id,
        deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : new Date(),
        items: items,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
    });

    const nowDelivered = this.sumQuantities(
      this.aggregateDeliveries([...deliveredRows, delivery]),
    );
    const isTotal = [...planned.keys()].every(
      (desc) => (nowDelivered.get(desc) ?? 0) >= (planned.get(desc) ?? 0),
    );

    const status = isTotal
      ? DeliveryOrderStatus.ENTREGADA
      : DeliveryOrderStatus.PARCIALMENTE_ENTREGADA;
    const deliveredAt = isTotal ? delivery.deliveredAt : doo.deliveredAt;

    const updated = await this.prisma.deliveryOrder.update({
      where: { id },
      data: { status, deliveredAt },
      include: { customer: true, invoice: true, purchaseOrder: true },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'DeliveryOrderDelivery',
        entityId: delivery.id,
        newValue: { deliveryOrderId: id, status },
      })
      .catch(() => {});

    return updated;
  }

  async markFullyDelivered(id: string, userId: string) {
    const doo = await this.findOne(id);
    if (doo.status === DeliveryOrderStatus.CANCELADA) {
      throw new BadRequestException(
        'No se puede completar una orden cancelada.',
      );
    }
    if (doo.status === DeliveryOrderStatus.ENTREGADA) {
      return doo;
    }

    const plannedItems = doo.items as Prisma.InputJsonValue as Array<{
      description: string;
      quantity: number;
      unitPrice?: number;
      taxRate?: number;
    }>;
    const planned = this.sumQuantities(plannedItems);
    const deliveredRows = await this.prisma.deliveryOrderDelivery.findMany({
      where: { deliveryOrderId: id },
    });
    const delivered = this.sumQuantities(
      this.aggregateDeliveries(deliveredRows),
    );

    const remaining = plannedItems
      .map((it) => {
        const left =
          Number(it.quantity) -
          (delivered.get(it.description.trim().toLowerCase()) ?? 0);
        return left > 0
          ? {
              description: it.description,
              quantity: left,
              unitPrice: it.unitPrice,
              taxRate: it.taxRate,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const deliveredAt = new Date();
    if (remaining.length > 0) {
      await this.prisma.deliveryOrderDelivery.create({
        data: {
          deliveryOrderId: id,
          deliveredAt,
          items: remaining.map((r) => this.normalizeDeliveryItem(r)),
          notes: 'Marcada como totalmente entregada',
          createdById: userId,
        },
      });
    }

    const updated = await this.prisma.deliveryOrder.update({
      where: { id },
      data: { status: DeliveryOrderStatus.ENTREGADA, deliveredAt },
      include: { customer: true, invoice: true, purchaseOrder: true },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.UPDATE,
        entityType: 'DeliveryOrder',
        entityId: id,
        oldValue: { status: doo.status },
        newValue: { status: updated.status, deliveredAt },
      })
      .catch(() => {});

    return updated;
  }

  async syncInvoiceFromDeliveries(id: string, userId: string) {
    const doo = await this.findOne(id);
    if (doo.status === DeliveryOrderStatus.CANCELADA) {
      throw new BadRequestException(
        'No se puede facturar una orden de entrega cancelada.',
      );
    }

    const deliveredRows = await this.prisma.deliveryOrderDelivery.findMany({
      where: { deliveryOrderId: id },
      orderBy: { deliveredAt: 'asc' },
    });
    if (deliveredRows.length === 0) {
      throw new BadRequestException(
        'Debe registrar al menos una entrega antes de facturar.',
      );
    }

    const plannedItems = doo.items as Prisma.InputJsonValue as Array<{
      description: string;
      quantity: number;
      unitPrice?: number;
      taxRate?: number;
    }>;
    const planned = this.sumQuantities(plannedItems);

    const deliveredMap = this.sumQuantities(
      this.aggregateDeliveries(deliveredRows),
    );
    const isTotal = [...planned.keys()].every(
      (desc) => (deliveredMap.get(desc) ?? 0) >= (planned.get(desc) ?? 0),
    );

    const byDesc = new Map<
      string,
      {
        description: string;
        quantity: number;
        unitPrice: number;
        taxRate: number;
      }
    >();
    const plannedByDesc = new Map<
      string,
      { unitPrice?: number; taxRate?: number }
    >();
    for (const it of plannedItems) {
      plannedByDesc.set(it.description.trim().toLowerCase(), it);
    }
    for (const it of this.aggregateDeliveries(deliveredRows)) {
      const key = it.description.trim().toLowerCase();
      const cur = byDesc.get(key);
      const inherited = plannedByDesc.get(key);
      byDesc.set(key, {
        description: it.description.trim(),
        quantity: (cur?.quantity ?? 0) + it.quantity,
        unitPrice: cur?.unitPrice || it.unitPrice || inherited?.unitPrice || 0,
        taxRate: cur?.taxRate || it.taxRate || inherited?.taxRate || 0,
      });
    }

    const computed = [...byDesc.values()].map((item) => {
      const quantity = toDecimal(item.quantity);
      const unitPrice = toDecimal(item.unitPrice ?? 0);
      const discount = toDecimal(0);
      const taxRate = toDecimal(item.taxRate ?? 0);
      const subtotal = quantity.mul(unitPrice).sub(discount);
      const taxAmount = subtotal.mul(taxRate).div(100);
      return {
        description: item.description,
        quantity,
        unitPrice,
        discount,
        taxRate,
        subtotal,
        taxAmount,
        total: subtotal.add(taxAmount),
      };
    });

    const subtotal = computed.reduce((s, i) => s.add(i.subtotal), toDecimal(0));
    const discountTotal = computed.reduce(
      (s, i) => s.add(i.discount),
      toDecimal(0),
    );
    const taxTotal = computed.reduce(
      (s, i) => s.add(i.taxAmount),
      toDecimal(0),
    );
    const total = computed.reduce((s, i) => s.add(i.total), toDecimal(0));

    const notes =
      [
        doo.notes ?? '',
        `Generada desde la orden de entrega ${doo.doNumber}`,
        isTotal ? null : 'Entrega parcial',
      ]
        .filter(Boolean)
        .join('\n')
        .trim() || null;

    if (!doo.invoiceId) {
      const invoice = await this.prisma.invoice.create({
        data: {
          customerId: doo.customerId,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          subtotal,
          discountTotal,
          taxTotal,
          total,
          paidAmount: toDecimal(0),
          balance: total,
          status: InvoiceStatus.BORRADOR,
          notes,
          createdById: userId,
          items: {
            create: computed.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              taxRate: item.taxRate,
              subtotal: item.subtotal,
              taxAmount: item.taxAmount,
              total: item.total,
            })),
          },
        },
        include: { items: true },
      });

      await this.prisma.deliveryOrder.update({
        where: { id: doo.id },
        data: { invoiceId: invoice.id },
      });

      await this.audit
        .log({
          userId,
          action: AuditAction.CREATE,
          entityType: 'Invoice',
          entityId: invoice.id,
          newValue: { source: 'DeliveryOrder', doNumber: doo.doNumber },
        })
        .catch(() => {});

      return invoice;
    }

    const existing = await this.prisma.invoice.findUnique({
      where: { id: doo.invoiceId },
      include: { items: true },
    });
    if (!existing) {
      throw new NotFoundException('La factura vinculada no existe.');
    }
    if (existing.status !== InvoiceStatus.BORRADOR) {
      return existing;
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const rows = existing.items;
      for (const line of computed) {
        const match = rows.find(
          (r) =>
            r.description.trim().toLowerCase() ===
            line.description.toLowerCase(),
        );
        if (match) {
          await tx.invoiceItem.update({
            where: { id: match.id },
            data: {
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              taxRate: line.taxRate,
              subtotal: line.subtotal,
              taxAmount: line.taxAmount,
              total: line.total,
            },
          });
        } else {
          await tx.invoiceItem.create({
            data: {
              invoiceId: existing.id,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              taxRate: line.taxRate,
              subtotal: line.subtotal,
              taxAmount: line.taxAmount,
              total: line.total,
            },
          });
        }
      }

      const all = await tx.invoiceItem.findMany({
        where: { invoiceId: existing.id },
      });
      const newSubtotal = all.reduce(
        (s, i) => s.add(toDecimal(i.subtotal)),
        toDecimal(0),
      );
      const newTax = all.reduce(
        (s, i) => s.add(toDecimal(i.taxAmount)),
        toDecimal(0),
      );
      const newTotal = all.reduce(
        (s, i) => s.add(toDecimal(i.total)),
        toDecimal(0),
      );
      const paid = toDecimal(existing.paidAmount ?? 0);
      const newBalance = newTotal.sub(paid);

      return await tx.invoice.update({
        where: { id: existing.id },
        data: {
          subtotal: newSubtotal,
          discountTotal: toDecimal(0),
          taxTotal: newTax,
          total: newTotal,
          balance: newBalance.lessThan(0) ? toDecimal(0) : newBalance,
        },
        include: { items: true },
      });
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.UPDATE,
        entityType: 'Invoice',
        entityId: invoice.id,
        newValue: { source: 'DeliveryOrder', doNumber: doo.doNumber, total },
      })
      .catch(() => {});

    return invoice;
  }
}
