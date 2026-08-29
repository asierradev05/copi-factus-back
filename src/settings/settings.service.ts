import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getSettings() {
    const settings = await this.prisma.companySettings.findUnique({
      where: { id: 'default' },
    });

    if (!settings) {
      throw new NotFoundException('Configuración de empresa no encontrada.');
    }

    return settings;
  }

  async updateSettings(dto: UpdateCompanySettingsDto, actorId: string) {
    const existing = await this.getSettings();

    const settings = await this.prisma.companySettings.update({
      where: { id: 'default' },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.legalName !== undefined
          ? { legalName: dto.legalName.trim() }
          : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId?.trim() } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl?.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.toLowerCase().trim() }
          : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() } : {}),
        ...(dto.invoicePrefix !== undefined
          ? { invoicePrefix: dto.invoicePrefix.trim() }
          : {}),
        ...(dto.invoiceNextNumber !== undefined
          ? { invoiceNextNumber: dto.invoiceNextNumber }
          : {}),
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: AuditAction.UPDATE,
      entityType: 'CompanySettings',
      entityId: settings.id,
      oldValue: existing,
      newValue: settings,
    });

    return settings;
  }
}
