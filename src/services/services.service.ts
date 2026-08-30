import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  InvoiceStatus,
  Prisma,
  ServiceStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { globalStore } from '../database/in-memory-store';
import { useInMemoryFallback } from '../common/utils/fallback.util';
import { calculateLineTotal, toDecimal } from '../common/utils/money.util';
import { allocateInvoiceNumber } from '../common/utils/invoice-number.util';
import {
  CreateServiceDto,
  FilterServiceDto,
  InvoiceFromServiceDto,
  UpdateServiceDto,
  UpdateServiceStatusDto,
} from './dto/service.dto';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findServiceTypes() {
    try {
      return await this.prisma.serviceType.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
      return globalStore.serviceTypes.filter((st) => st.isActive);
    }
  }

  async createServiceType(dto: CreateServiceTypeDto, actorId: string) {
    try {
      const existing = await this.prisma.serviceType.findUnique({
        where: { name: dto.name.trim() },
      });
      if (existing) {
        throw new ConflictException(
          'Ya existe un tipo de servicio con ese nombre.',
        );
      }

      const serviceType = await this.prisma.serviceType.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim(),
        },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'ServiceType',
          entityId: serviceType.id,
          newValue: serviceType,
        })
        .catch(() => {});

      return serviceType;
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
      if (!useInMemoryFallback()) throw err;
      const newType = {
        id: `st-${Date.now()}`,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      globalStore.serviceTypes.push(newType);
      return newType;
    }
  }

  async findAll(filters: FilterServiceDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.ServiceWhereInput = {};
      if (filters.customerId) where.customerId = filters.customerId;
      if (filters.status) where.status = filters.status;

      const [data, total] = await Promise.all([
        this.prisma.service.findMany({
          where,
          include: {
            customer: true,
            serviceType: true,
            invoiceLink: { include: { invoice: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.service.count({ where }),
      ]);

      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
      let filtered = globalStore.services;
      if (filters.customerId) {
        filtered = filtered.filter((s) => s.customerId === filters.customerId);
      }
      if (filters.status) {
        filtered = filtered.filter((s) => s.status === filters.status);
      }
      const data = filtered.slice(skip, skip + limit);
      const total = filtered.length;
      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }
  }

  async findPendingInvoice() {
    try {
      return await this.prisma.service.findMany({
        where: {
          status: { in: [ServiceStatus.TERMINADO, ServiceStatus.ENTREGADO] },
          invoiceLink: null,
        },
        include: { customer: true, serviceType: true },
        orderBy: { requestedAt: 'asc' },
      });
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
      return globalStore.services.filter(
        (s) =>
          (s.status === ServiceStatus.TERMINADO ||
            s.status === ServiceStatus.ENTREGADO) &&
          !s.invoiceLink,
      );
    }
  }

  async findOne(id: string) {
    try {
      const service = await this.prisma.service.findUnique({
        where: { id },
        include: {
          customer: true,
          serviceType: true,
          invoiceLink: { include: { invoice: true } },
        },
      });
      if (service) return service;
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
    }

    const memService = globalStore.services.find((s) => s.id === id);
    if (!memService) {
      throw new NotFoundException('Servicio no encontrado.');
    }
    return memService;
  }

  async create(dto: CreateServiceDto, actorId: string) {
    const { subtotal, total } = calculateLineTotal(
      dto.quantity,
      dto.unitPrice,
      dto.discount ?? 0,
      dto.taxRate ?? 0,
    );

    try {
      await this.ensureCustomerExists(dto.customerId);
      await this.ensureServiceTypeExists(dto.serviceTypeId);

      const service = await this.prisma.service.create({
        data: {
          customerId: dto.customerId,
          serviceTypeId: dto.serviceTypeId,
          description: dto.description.trim(),
          quantity: toDecimal(dto.quantity),
          unitPrice: toDecimal(dto.unitPrice),
          discount: toDecimal(dto.discount ?? 0),
          taxRate: toDecimal(dto.taxRate ?? 0),
          subtotal,
          total,
          requestedAt: new Date(dto.requestedAt),
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          assignedTo: dto.assignedTo?.trim(),
          notes: dto.notes?.trim(),
          createdById: actorId,
        },
        include: { customer: true, serviceType: true },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'Service',
          entityId: service.id,
          newValue: service,
        })
        .catch(() => {});

      return service;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      if (!useInMemoryFallback()) throw err;

      const customer = globalStore.customers.find(
        (c) => c.id === dto.customerId,
      ) ?? {
        id: dto.customerId,
        name: 'Cliente Demo',
      };
      const serviceType = globalStore.serviceTypes.find(
        (st) => st.id === dto.serviceTypeId,
      ) ?? {
        id: dto.serviceTypeId,
        name: 'Servicio Demo',
      };

      const newService = {
        id: randomUUID(),
        customerId: dto.customerId,
        serviceTypeId: dto.serviceTypeId,
        description: dto.description.trim(),
        quantity: dto.quantity,
        unitPrice: dto.unitPrice,
        discount: dto.discount ?? 0,
        taxRate: dto.taxRate ?? 0,
        subtotal: subtotal.toNumber ? subtotal.toNumber() : Number(subtotal),
        total: total.toNumber ? total.toNumber() : Number(total),
        requestedAt: new Date(dto.requestedAt),
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        status: ServiceStatus.SOLICITADO,
        assignedTo: dto.assignedTo?.trim(),
        notes: dto.notes?.trim(),
        customer,
        serviceType,
        invoiceLink: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      globalStore.services.push(newService);
      return newService;
    }
  }

  async updateStatus(id: string, dto: UpdateServiceStatusDto, actorId: string) {
    const existing = await this.findOne(id);

    if (existing.status === ServiceStatus.FACTURADO) {
      throw new BadRequestException(
        'No se puede cambiar el estado de un servicio facturado.',
      );
    }

    try {
      const service = await this.prisma.service.update({
        where: { id },
        data: { status: dto.status },
        include: { customer: true, serviceType: true },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.UPDATE,
          entityType: 'Service',
          entityId: service.id,
          oldValue: { status: existing.status },
          newValue: { status: service.status },
        })
        .catch(() => {});

      return service;
    } catch {
      existing.status = dto.status;
      existing.updatedAt = new Date();
      return existing;
    }
  }

  async update(id: string, dto: UpdateServiceDto, actorId: string) {
    const existing = await this.findOne(id);

    if (existing.status === ServiceStatus.FACTURADO) {
      throw new BadRequestException(
        'No se puede editar un servicio facturado.',
      );
    }

    if (dto.serviceTypeId !== undefined) {
      await this.ensureServiceTypeExists(dto.serviceTypeId);
    }

    const quantity = dto.quantity ?? Number(existing.quantity);
    const unitPrice = dto.unitPrice ?? Number(existing.unitPrice);
    const discount = dto.discount ?? Number(existing.discount);
    const taxRate = dto.taxRate ?? Number(existing.taxRate);
    const { subtotal, total } = calculateLineTotal(
      quantity,
      unitPrice,
      discount,
      taxRate,
    );

    try {
      const service = await this.prisma.service.update({
        where: { id },
        data: {
          ...(dto.serviceTypeId !== undefined
            ? { serviceTypeId: dto.serviceTypeId }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() }
            : {}),
          quantity: toDecimal(quantity),
          unitPrice: toDecimal(unitPrice),
          discount: toDecimal(discount),
          taxRate: toDecimal(taxRate),
          subtotal,
          total,
          ...(dto.deliveryDate !== undefined
            ? {
                deliveryDate: dto.deliveryDate
                  ? new Date(dto.deliveryDate)
                  : null,
              }
            : {}),
          ...(dto.assignedTo !== undefined
            ? { assignedTo: dto.assignedTo?.trim() }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() } : {}),
        },
        include: { customer: true, serviceType: true },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.UPDATE,
          entityType: 'Service',
          entityId: service.id,
          oldValue: existing,
          newValue: service,
        })
        .catch(() => {});

      return service;
    } catch {
      Object.assign(existing, {
        ...(dto.serviceTypeId !== undefined
          ? { serviceTypeId: dto.serviceTypeId }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        quantity,
        unitPrice,
        discount,
        taxRate,
        subtotal: subtotal.toNumber(),
        total: total.toNumber(),
        ...(dto.deliveryDate !== undefined
          ? {
              deliveryDate: dto.deliveryDate
                ? new Date(dto.deliveryDate)
                : null,
            }
          : {}),
        ...(dto.assignedTo !== undefined
          ? { assignedTo: dto.assignedTo?.trim() }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() } : {}),
        updatedAt: new Date(),
      });

      return existing;
    }
  }

  async invoiceFromService(
    serviceId: string,
    dto: InvoiceFromServiceDto,
    actorId: string,
  ) {
    const service = await this.findOne(serviceId);

    if (
      service.status !== ServiceStatus.TERMINADO &&
      service.status !== ServiceStatus.ENTREGADO
    ) {
      throw new BadRequestException(
        'Solo se pueden facturar servicios terminados o entregados.',
      );
    }

    if (service.invoiceLink) {
      throw new ConflictException(
        'El servicio ya está vinculado a una factura.',
      );
    }

    const sTotal = Number(service.total);
    const sSubtotal = Number(service.subtotal);
    const taxAmount = sTotal - sSubtotal;
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        const { invoiceNumber } = await allocateInvoiceNumber(tx);

        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            customerId: service.customerId,
            issueDate: new Date(),
            dueDate,
            subtotal: toDecimal(sSubtotal),
            discountTotal: toDecimal(service.discount),
            taxTotal: toDecimal(taxAmount),
            total: toDecimal(sTotal),
            paidAmount: toDecimal(0),
            balance: toDecimal(sTotal),
            status: InvoiceStatus.EMITIDA,
            notes: dto.notes?.trim(),
            createdById: actorId,
            items: {
              create: {
                description: `${service.serviceType?.name || 'Servicio'}: ${service.description}`,
                quantity: toDecimal(service.quantity),
                unitPrice: toDecimal(service.unitPrice),
                discount: toDecimal(service.discount),
                taxRate: toDecimal(service.taxRate),
                subtotal: toDecimal(sSubtotal),
                taxAmount: toDecimal(taxAmount),
                total: toDecimal(sTotal),
              },
            },
            serviceLinks: {
              create: { serviceId: service.id },
            },
          },
          include: { items: true, customer: true, serviceLinks: true },
        });

        await tx.service.update({
          where: { id: service.id },
          data: { status: ServiceStatus.FACTURADO },
        });

        return created;
      });

      return invoice;
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
      const nextNum = globalStore.companySettings.invoiceNextNumber++;
      const invoiceNumber = `${globalStore.companySettings.invoicePrefix}-${String(nextNum).padStart(6, '0')}`;
      const invId = randomUUID();

      const createdInvoice = {
        id: invId,
        invoiceNumber,
        customerId: service.customerId,
        issueDate: new Date(),
        dueDate,
        subtotal: sSubtotal,
        discountTotal: Number(service.discount),
        taxTotal: taxAmount,
        total: sTotal,
        paidAmount: 0,
        balance: sTotal,
        status: InvoiceStatus.EMITIDA,
        notes: dto.notes?.trim(),
        items: [
          {
            id: randomUUID(),
            invoiceId: invId,
            description: `${service.serviceType?.name || 'Servicio'}: ${service.description}`,
            quantity: service.quantity,
            unitPrice: service.unitPrice,
            discount: service.discount,
            taxRate: service.taxRate,
            subtotal: sSubtotal,
            taxAmount,
            total: sTotal,
          },
        ],
        payments: [],
      };

      service.status = ServiceStatus.FACTURADO;
      service.invoiceLink = { invoiceId: invId, invoice: createdInvoice };
      globalStore.invoices.push(createdInvoice);

      return createdInvoice;
    }
  }

  private async ensureCustomerExists(customerId: string) {
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null, isActive: true },
      });
      if (customer) return;
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
    }

    const memCust = globalStore.customers.find(
      (c) => c.id === customerId && !c.deletedAt,
    );
    if (!memCust) {
      throw new NotFoundException('Cliente no encontrado o inactivo.');
    }
  }

  private async ensureServiceTypeExists(serviceTypeId: string) {
    try {
      const serviceType = await this.prisma.serviceType.findFirst({
        where: { id: serviceTypeId, isActive: true },
      });
      if (serviceType) return;
    } catch (err) {
      if (!useInMemoryFallback()) throw err;
    }

    const memST = globalStore.serviceTypes.find(
      (st) => st.id === serviceTypeId,
    );
    if (!memST) {
      throw new NotFoundException('Tipo de servicio no encontrado.');
    }
  }
}
