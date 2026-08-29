import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { globalStore } from '../database/in-memory-store';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FilterCustomerDto } from './dto/filter-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(filters: FilterCustomerDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.CustomerWhereInput = { deletedAt: null };
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { documentNumber: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        this.prisma.customer.findMany({
          where,
          orderBy: { name: 'asc' },
          skip,
          take: limit,
        }),
        this.prisma.customer.count({ where }),
      ]);

      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch {
      let filtered = globalStore.customers.filter((c) => !c.deletedAt);
      if (filters.isActive !== undefined) {
        filtered = filtered.filter((c) => c.isActive === filters.isActive);
      }
      if (filters.search) {
        const s = filters.search.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.name.toLowerCase().includes(s) ||
            c.documentNumber.toLowerCase().includes(s) ||
            (c.email && c.email.toLowerCase().includes(s)),
        );
      }
      const data = filtered.slice(skip, skip + limit);
      const total = filtered.length;
      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }
  }

  async findOne(id: string) {
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { id, deletedAt: null },
      });
      if (customer) return customer;
    } catch {}

    const memCustomer = globalStore.customers.find(
      (c) => c.id === id && !c.deletedAt,
    );
    if (!memCustomer) {
      throw new NotFoundException('Cliente no encontrado.');
    }
    return memCustomer;
  }

  async create(dto: CreateCustomerDto, actorId: string) {
    const docNumber = dto.documentNumber.trim();
    try {
      const existing = await this.prisma.customer.findUnique({
        where: { documentNumber: docNumber },
      });
      if (existing && !existing.deletedAt) {
        throw new ConflictException(
          'Ya existe un cliente con ese número de documento.',
        );
      }

      const customer = await this.prisma.customer.create({
        data: {
          name: dto.name.trim(),
          documentType: dto.documentType,
          documentNumber: docNumber,
          phone: dto.phone?.trim(),
          email: dto.email?.toLowerCase().trim(),
          address: dto.address?.trim(),
          city: dto.city?.trim(),
          notes: dto.notes?.trim(),
        },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.CREATE,
          entityType: 'Customer',
          entityId: customer.id,
          newValue: customer,
        })
        .catch(() => {});

      return customer;
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;

      const id = randomUUID();
      const newCust = {
        id,
        name: dto.name.trim(),
        documentType: dto.documentType,
        documentNumber: docNumber,
        phone: dto.phone?.trim(),
        email: dto.email?.toLowerCase().trim(),
        address: dto.address?.trim(),
        city: dto.city?.trim(),
        notes: dto.notes?.trim(),
        isActive: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      globalStore.customers.push(newCust);
      return newCust;
    }
  }

  async update(id: string, dto: UpdateCustomerDto, actorId: string) {
    const existing = await this.findOne(id);

    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.documentType !== undefined
            ? { documentType: dto.documentType }
            : {}),
          ...(dto.documentNumber !== undefined
            ? { documentNumber: dto.documentNumber.trim() }
            : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() } : {}),
          ...(dto.email !== undefined
            ? { email: dto.email?.toLowerCase().trim() }
            : {}),
          ...(dto.address !== undefined ? { address: dto.address?.trim() } : {}),
          ...(dto.city !== undefined ? { city: dto.city?.trim() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() } : {}),
        },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.UPDATE,
          entityType: 'Customer',
          entityId: customer.id,
          oldValue: existing,
          newValue: customer,
        })
        .catch(() => {});

      return customer;
    } catch {
      Object.assign(existing, {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.documentType !== undefined
          ? { documentType: dto.documentType }
          : {}),
        ...(dto.documentNumber !== undefined
          ? { documentNumber: dto.documentNumber.trim() }
          : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.toLowerCase().trim() }
          : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() } : {}),
        updatedAt: new Date(),
      });
      return existing;
    }
  }

  async remove(id: string, actorId: string) {
    const existing = await this.findOne(id);

    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      await this.auditService
        .log({
          userId: actorId,
          action: AuditAction.DELETE,
          entityType: 'Customer',
          entityId: customer.id,
          oldValue: existing,
          newValue: customer,
        })
        .catch(() => {});

      return customer;
    } catch {
      existing.isActive = false;
      existing.deletedAt = new Date();
      return existing;
    }
  }
}
