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
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/utils/document-sequence.util';
import { toDecimal } from '../common/utils/money.util';
import {
  CreateDeliveryOrderDto,
  FilterDeliveryOrderDto,
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
      include: { customer: true, invoice: true, purchaseOrder: true },
    });
    if (!doo) {
      throw new NotFoundException('La orden de entrega no fue encontrada.');
    }
    return doo;
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

  async convertToInvoice(id: string, userId: string) {
    const doo = await this.findOne(id);

    if (doo.status === DeliveryOrderStatus.CANCELADA) {
      throw new BadRequestException(
        'No se puede facturar una orden de entrega cancelada.',
      );
    }
    if (doo.invoiceId) {
      throw new BadRequestException(
        'Esta orden de entrega ya tiene una factura asociada.',
      );
    }

    const items = doo.items as Prisma.InputJsonValue as Array<{
      description: string;
      quantity: number;
      unitPrice?: number;
      discount?: number;
      taxRate?: number;
    }>;

    const computed = items.map((item) => {
      const quantity = toDecimal(item.quantity);
      const unitPrice = toDecimal(item.unitPrice ?? 0);
      const discount = toDecimal(item.discount ?? 0);
      const taxRate = toDecimal(item.taxRate ?? 0);
      const subtotal = quantity.mul(unitPrice).sub(discount);
      const taxAmount = subtotal.mul(taxRate).div(100);
      const total = subtotal.add(taxAmount);
      return {
        description: item.description,
        quantity,
        unitPrice,
        discount,
        taxRate,
        subtotal,
        taxAmount,
        total,
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

    const invoice = await this.prisma.invoice.create({
      data: {
        customerId: doo.customerId,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        subtotal: subtotal,
        discountTotal: discountTotal,
        taxTotal: taxTotal,
        total: total,
        paidAmount: toDecimal(0),
        balance: total,
        status: InvoiceStatus.BORRADOR,
        notes: doo.notes,
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
      include: { items: true, customer: true },
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
}
