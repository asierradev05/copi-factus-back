import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll() {
    return this.prisma.profile.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.profile.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    return user;
  }

  async create(dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.profile.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese correo.');
    }

    const user = await this.prisma.profile.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        fullName: dto.fullName.trim(),
        role: dto.role,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.CREATE,
      entityType: 'Profile',
      entityId: user.id,
      newValue: user,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const existing = await this.findOne(id);

    if (dto.email && dto.email.toLowerCase().trim() !== existing.email) {
      const emailTaken = await this.prisma.profile.findUnique({
        where: { email: dto.email.toLowerCase().trim() },
      });
      if (emailTaken) {
        throw new ConflictException('Ya existe un usuario con ese correo.');
      }
    }

    const user = await this.prisma.profile.update({
      where: { id },
      data: {
        ...(dto.email !== undefined
          ? { email: dto.email.toLowerCase().trim() }
          : {}),
        ...(dto.fullName !== undefined
          ? { fullName: dto.fullName.trim() }
          : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.UPDATE,
      entityType: 'Profile',
      entityId: user.id,
      oldValue: existing,
      newValue: user,
    });

    return user;
  }

  async remove(id: string, actorId: string) {
    const existing = await this.findOne(id);

    const user = await this.prisma.profile.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.DELETE,
      entityType: 'Profile',
      entityId: user.id,
      oldValue: existing,
      newValue: user,
    });

    return user;
  }
}
