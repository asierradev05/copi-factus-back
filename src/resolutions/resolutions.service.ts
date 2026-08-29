import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateResolutionDto,
  FilterResolutionDto,
  UpdateResolutionDto,
} from './dto/resolution.dto';

@Injectable()
export class ResolutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: FilterResolutionDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ResolutionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.ambient) where.ambient = query.ambient;

    const [data, total] = await Promise.all([
      this.prisma.resolution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.resolution.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const resolution = await this.prisma.resolution.findUnique({
      where: { id },
    });
    if (!resolution) {
      throw new NotFoundException('La resolución no fue encontrada.');
    }
    return resolution;
  }

  async create(dto: CreateResolutionDto, userId: string) {
    if (dto.from > dto.to) {
      throw new BadRequestException(
        'El rango inicial no puede ser mayor que el rango final.',
      );
    }

    const resolution = await this.prisma.resolution.create({
      data: {
        prefix: dto.prefix.trim().toUpperCase(),
        resolutionNumber: dto.resolutionNumber.trim(),
        from: dto.from,
        to: dto.to,
        next: dto.next ?? dto.from,
        dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : null,
        dateTo: dto.dateTo ? new Date(dto.dateTo) : null,
        type: dto.type ?? 'FACTURA',
        ambient: dto.ambient ?? 'PRODUCCION',
        isActive: true,
      },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'Resolution',
        entityId: resolution.id,
        newValue: { prefix: resolution.prefix },
      })
      .catch(() => {});

    return resolution;
  }

  async update(id: string, dto: UpdateResolutionDto, userId: string) {
    await this.findOne(id);

    if (dto.from !== undefined && dto.to !== undefined && dto.from > dto.to) {
      throw new BadRequestException(
        'El rango inicial no puede ser mayor que el rango final.',
      );
    }

    const resolution = await this.prisma.resolution.update({
      where: { id },
      data: {
        ...(dto.prefix !== undefined
          ? { prefix: dto.prefix.trim().toUpperCase() }
          : {}),
        ...(dto.resolutionNumber !== undefined
          ? { resolutionNumber: dto.resolutionNumber.trim() }
          : {}),
        ...(dto.from !== undefined
          ? {
              from: dto.from,
              ...(dto.next === undefined ? { next: dto.from } : {}),
            }
          : {}),
        ...(dto.to !== undefined ? { to: dto.to } : {}),
        ...(dto.next !== undefined ? { next: dto.next } : {}),
        ...(dto.dateFrom !== undefined
          ? { dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : null }
          : {}),
        ...(dto.dateTo !== undefined
          ? { dateTo: dto.dateTo ? new Date(dto.dateTo) : null }
          : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.ambient !== undefined ? { ambient: dto.ambient } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.UPDATE,
        entityType: 'Resolution',
        entityId: id,
        newValue: { prefix: resolution.prefix, next: resolution.next },
      })
      .catch(() => {});

    return resolution;
  }

  async nextConsecutive(id: string, userId: string) {
    const resolution = await this.findOne(id);

    if (!resolution.isActive) {
      throw new BadRequestException('La resolución no está activa.');
    }

    if (resolution.next > resolution.to) {
      throw new BadRequestException('La resolución agotó su rango disponible.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ prefix: string; next: number; to: number }>
      >`
        SELECT prefix, next, "to", is_active
        FROM resolutions
        WHERE id = ${id}
        FOR UPDATE
      `;

      const current = rows[0];
      if (!current) {
        throw new NotFoundException('La resolución no fue encontrada.');
      }
      if (!current.next) {
        throw new BadRequestException('La resolución no está activa.');
      }
      if (current.next > current.to) {
        throw new BadRequestException(
          'La resolución agotó su rango disponible.',
        );
      }

      const number = `${current.prefix}${String(current.next).padStart(6, '0')}`;

      await tx.resolution.update({
        where: { id },
        data: { next: current.next + 1 },
      });

      return { number, next: current.next + 1 };
    });

    await this.audit
      .log({
        userId,
        action: AuditAction.CREATE,
        entityType: 'Resolution',
        entityId: id,
        newValue: { number: result.number },
      })
      .catch(() => {});

    return result;
  }
}
