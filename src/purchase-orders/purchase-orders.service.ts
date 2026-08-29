import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/utils/document-sequence.util';
import { toDecimal } from '../common/utils/money.util';
import {
  CreatePurchaseOrderDto,
  FilterPurchaseOrderDto,
  UpdatePurchaseOrderStatusDto,
} from './dto/purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: FilterPurchaseOrderDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.issueDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { customer: true, invoice: true },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { customer: true, invoice: true },
    });
    if (!po) {
      throw new NotFoundException('La orden de compra no fue encontrada.');
    }
    return po;
  }

  async create(dto: CreatePurchaseOrderDto, userId: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'La orden de compra debe tener al menos un ítem.',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new BadRequestException('El cliente seleccionado no existe.');
    }

    const { items, subtotal, discountTotal, taxTotal, total } =
      this.computeItems(dto.items);

    const poNumber = await this.prisma.$transaction((tx) =>
      nextDocumentNumber(tx, 'purchase-order', 'OC'),
    );

    const po = await this.prisma.purchaseOrder.create({
      data: {
        poNumber,
        customerId: dto.customerId,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
        invoiceId: dto.invoiceId,
        items,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        notes: dto.notes?.trim(),
        createdById: userId,
      },
      include: { customer: true, invoice: true },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'PurchaseOrder',
        entityId: po.id,
        newValue: { poNumber, total: total.toNumber() },
      })
      .catch(() => {});

    return po;
  }

  async updateStatus(
    id: string,
    dto: UpdatePurchaseOrderStatusDto,
    userId: string,
  ) {
    const current = await this.findOne(id);

    if (current.status === PurchaseOrderStatus.CANCELADA) {
      throw new BadRequestException('La orden de compra ya está cancelada.');
    }

    const po = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: dto.status },
      include: { customer: true, invoice: true },
    });

    await this.audit
      .log({
        userId,
        action:
          dto.status === PurchaseOrderStatus.CANCELADA
            ? AuditAction.CANCEL
            : AuditAction.UPDATE,
        entityType: 'PurchaseOrder',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: dto.status },
      })
      .catch(() => {});

    return po;
  }

  private computeItems(items: CreatePurchaseOrderDto['items']) {
    const computed = items.map((item) => {
      const quantity = toDecimal(item.quantity);
      const unitPrice = toDecimal(item.unitPrice);
      const discount = toDecimal(item.discount ?? 0);
      const taxRate = toDecimal(item.taxRate ?? 0);

      const lineExtension = quantity.mul(unitPrice);
      const subtotal = lineExtension.sub(discount);
      const taxAmount = subtotal.mul(taxRate).div(100);
      const total = subtotal.add(taxAmount);

      return {
        description: item.description.trim(),
        quantity: quantity.toNumber(),
        unitPrice: unitPrice.toNumber(),
        discount: discount.toNumber(),
        taxRate: taxRate.toNumber(),
        subtotal: subtotal.toNumber(),
        taxAmount: taxAmount.toNumber(),
        total: total.toNumber(),
      };
    });

    return {
      items: computed as Prisma.InputJsonValue,
      subtotal: toDecimal(computed.reduce((s, i) => s + i.subtotal, 0)),
      discountTotal: toDecimal(computed.reduce((s, i) => s + i.discount, 0)),
      taxTotal: toDecimal(computed.reduce((s, i) => s + i.taxAmount, 0)),
      total: toDecimal(computed.reduce((s, i) => s + i.total, 0)),
    };
  }
}
