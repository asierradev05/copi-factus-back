import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, RecurringServiceStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateRecurringServiceDto,
  CreateServiceCategoryDto,
  CreateServiceSubcategoryDto,
  FilterRecurringServiceDto,
  UpdateRecurringServiceDto,
  UpdateRecurringServiceStatusDto,
} from './dto/recurring-service.dto';

@Injectable()
export class RecurringServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listCategories() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { subcategories: true, services: true } } },
    });
  }

  async createCategory(dto: CreateServiceCategoryDto, userId: string) {
    const category = await this.prisma.serviceCategory.create({
      data: { name: dto.name, description: dto.description },
    });
    await this.audit.log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'ServiceCategory',
      entityId: category.id,
      newValue: { name: category.name },
    });
    return category;
  }

  async listSubcategories(categoryId?: string) {
    return this.prisma.serviceSubcategory.findMany({
      where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
      orderBy: { name: 'asc' },
      include: { category: true, _count: { select: { services: true } } },
    });
  }

  async createSubcategory(dto: CreateServiceSubcategoryDto, userId: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new BadRequestException('La categoría seleccionada no existe.');
    }
    const subcategory = await this.prisma.serviceSubcategory.create({
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
      },
    });
    await this.audit.log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'ServiceSubcategory',
      entityId: subcategory.id,
      newValue: { name: subcategory.name, categoryId: subcategory.categoryId },
    });
    return subcategory;
  }

  async findAll(query: FilterRecurringServiceDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.RecurringServiceWhereInput = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subcategoryId) where.subcategoryId = query.subcategoryId;
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.recurringService.findMany({
        where,
        include: { category: true, subcategory: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.recurringService.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const service = await this.prisma.recurringService.findUnique({
      where: { id },
      include: { category: true, subcategory: true },
    });
    if (!service) {
      throw new NotFoundException('El servicio recurrente no fue encontrado.');
    }
    return service;
  }

  async create(dto: CreateRecurringServiceDto, userId: string) {
    await this.validateReferences(dto.categoryId, dto.subcategoryId);
    const service = await this.prisma.recurringService.create({
      data: {
        categoryId: dto.categoryId,
        subcategoryId: dto.subcategoryId,
        name: dto.name,
        provider: dto.provider,
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        billingDay: dto.billingDay,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
        createdById: userId,
      },
    });
    await this.audit.log({
      userId,
      action: AuditAction.CREATE,
      entityType: 'RecurringService',
      entityId: service.id,
      newValue: { name: service.name, amount: service.amount.toNumber() },
    });
    return this.findOne(service.id);
  }

  async update(id: string, dto: UpdateRecurringServiceDto, userId: string) {
    await this.findOne(id);
    if (dto.categoryId || dto.subcategoryId) {
      await this.validateReferences(
        dto.categoryId ?? undefined,
        dto.subcategoryId ?? undefined,
      );
    }
    const service = await this.prisma.recurringService.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.subcategoryId !== undefined
          ? { subcategoryId: dto.subcategoryId }
          : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.amount !== undefined
          ? { amount: new Prisma.Decimal(dto.amount) }
          : {}),
        ...(dto.billingDay !== undefined ? { billingDay: dto.billingDay } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
      },
    });
    await this.audit.log({
      userId,
      action: AuditAction.UPDATE,
      entityType: 'RecurringService',
      entityId: id,
      newValue: { name: service.name },
    });
    return this.findOne(id);
  }

  async updateStatus(
    id: string,
    dto: UpdateRecurringServiceStatusDto,
    userId: string,
  ) {
    const current = await this.findOne(id);

    if (dto.status === RecurringServiceStatus.CANCELADO) {
      await this.audit.log({
        userId,
        action: AuditAction.CANCEL,
        entityType: 'RecurringService',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: dto.status },
      });
    } else if (dto.status === RecurringServiceStatus.PAGADO) {
      await this.audit.log({
        userId,
        action: AuditAction.PAYMENT,
        entityType: 'RecurringService',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: dto.status },
      });
    }

    const service = await this.prisma.recurringService.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === RecurringServiceStatus.PAGADO
          ? { lastPaidAt: new Date() }
          : {}),
      },
    });

    if (dto.status === RecurringServiceStatus.ACTIVO) {
      await this.audit.log({
        userId,
        action: AuditAction.UPDATE,
        entityType: 'RecurringService',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: dto.status },
      });
    }

    return this.findOne(service.id);
  }

  async summary() {
    const [total, paid, active, totalMonthly] = await Promise.all([
      this.prisma.recurringService.count(),
      this.prisma.recurringService.count({
        where: { status: RecurringServiceStatus.PAGADO },
      }),
      this.prisma.recurringService.count({
        where: { status: RecurringServiceStatus.ACTIVO },
      }),
      this.prisma.recurringService.aggregate({
        where: { status: RecurringServiceStatus.ACTIVO },
        _sum: { amount: true },
      }),
    ]);

    return {
      total,
      paid,
      active,
      monthlyTotal: (
        totalMonthly._sum.amount ?? new Prisma.Decimal(0)
      ).toNumber(),
    };
  }

  private async validateReferences(
    categoryId?: string,
    subcategoryId?: string,
  ) {
    if (categoryId) {
      const category = await this.prisma.serviceCategory.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        throw new BadRequestException('La categoría seleccionada no existe.');
      }
    }
    if (subcategoryId) {
      const subcategory = await this.prisma.serviceSubcategory.findUnique({
        where: { id: subcategoryId },
      });
      if (!subcategory) {
        throw new BadRequestException(
          'La subcategoría seleccionada no existe.',
        );
      }
      if (!categoryId) return;
      if (subcategory.categoryId !== categoryId) {
        throw new BadRequestException(
          'La subcategoría no pertenece a la categoría seleccionada.',
        );
      }
    }
  }
}
