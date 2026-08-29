import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../common/utils/money.util';
import {
  CreateProductDto,
  FilterProductDto,
  UpdateProductDto,
} from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(filters: FilterProductDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      isActive: true,
    };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado.');
    }
    return product;
  }

  async create(dto: CreateProductDto, actorId: string) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.product.findUnique({
      where: { code },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('Ya existe un producto con ese código.');
    }

    const product = await this.prisma.product.create({
      data: {
        code,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        unitPrice: toDecimal(dto.unitPrice),
        taxRate: toDecimal(dto.taxRate ?? 0),
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.CREATE,
      entityType: 'Product',
      entityId: product.id,
      newValue: product,
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const existing = await this.findOne(id);

    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      const codeTaken = await this.prisma.product.findFirst({
        where: {
          code: dto.code.trim().toUpperCase(),
          deletedAt: null,
          NOT: { id },
        },
      });
      if (codeTaken) {
        throw new ConflictException('Ya existe un producto con ese código.');
      }
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.code !== undefined
          ? { code: dto.code.trim().toUpperCase() }
          : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() }
          : {}),
        ...(dto.unitPrice !== undefined
          ? { unitPrice: toDecimal(dto.unitPrice) }
          : {}),
        ...(dto.taxRate !== undefined
          ? { taxRate: toDecimal(dto.taxRate) }
          : {}),
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.UPDATE,
      entityType: 'Product',
      entityId: product.id,
      oldValue: existing,
      newValue: product,
    });

    return product;
  }

  async remove(id: string, actorId: string) {
    const existing = await this.findOne(id);

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.DELETE,
      entityType: 'Product',
      entityId: product.id,
      oldValue: existing,
      newValue: product,
    });

    return product;
  }
}
