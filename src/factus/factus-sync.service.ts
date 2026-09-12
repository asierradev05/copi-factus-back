import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { FactusAuthService } from './factus-auth.service';
import { FactusAdapterService } from './factus-adapter.service';
import { extractRangeId, mapResolutionTypeToDian } from './factus-utils';
import type { FactusStatus } from './factus-types';

@Injectable()
export class FactusSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: FactusAuthService,
    private readonly adapter: FactusAdapterService,
  ) {}

  async getStatus(): Promise<FactusStatus> {
    let emisorSynced = false;
    try {
      const settings = await this.prisma.companySettings.findUnique({
        where: { id: 'default' },
      });
      emisorSynced = settings?.isSyncedToFactus ?? false;
    } catch {
      emisorSynced = false;
    }
    const configured = this.auth.isConfigured();
    return {
      configured,
      ambient: process.env.FACTUS_AMBIENT ?? 'sandbox',
      emisorSynced,
      url: configured ? this.auth.getBaseUrl() : null,
    };
  }

  async syncCompany(actorId: string): Promise<any> {
    const settings = await this.prisma.companySettings.findUnique({
      where: { id: 'default' },
    });
    if (!settings) {
      throw new NotFoundException('Configuración de empresa no encontrada.');
    }
    const responsibilities =
      (settings.responsibilities as Array<{ code: string }> | null) ?? [];
    const payload = {
      legal_organization_code: settings.legalOrganizationCode ?? 1,
      company: settings.legalName,
      trade_name: settings.tradeName ?? settings.name,
      email: settings.email ?? '',
      address: settings.address ?? '',
      registration_code: settings.registrationCode ?? '',
      phone: settings.phone ?? '',
      municipality_code: settings.municipalityCode ?? '11001',
      economic_activity: settings.economicActivity ?? '',
      tribute_code: settings.tributeCode ?? '01',
      responsibilities:
        responsibilities.length > 0 ? responsibilities : [{ code: 'O-13' }],
    };
    const result = await this.adapter.updateCompany(payload);
    await this.prisma.companySettings.update({
      where: { id: 'default' },
      data: { isSyncedToFactus: true },
    });
    await this.audit
      .log({
        userId: actorId,
        action: AuditAction.UPDATE,
        entityType: 'FactusCompany',
        entityId: 'default',
        newValue: result as Prisma.InputJsonValue,
      })
      .catch(() => {});
    return result;
  }

  async syncResolutionRange(id: string, actorId: string): Promise<any> {
    const resolution = await this.prisma.resolution.findUnique({
      where: { id },
    });
    if (!resolution) {
      throw new NotFoundException('La resolución no fue encontrada.');
    }
    const documentCode = mapResolutionTypeToDian(resolution.type);
    const payload = {
      document: documentCode,
      prefix: resolution.prefix.replace(/-$/, ''),
      resolution_number:
        resolution.resolutionNumber &&
        !Number.isNaN(Number(resolution.resolutionNumber))
          ? Number(resolution.resolutionNumber)
          : undefined,
      current: Math.max((resolution.next ?? 0) - 1, 0),
      start_number: resolution.from,
      end_number: resolution.to,
      ...(resolution.dateFrom
        ? { start_date: resolution.dateFrom.toISOString().slice(0, 10) }
        : {}),
      ...(resolution.dateTo
        ? { end_date: resolution.dateTo.toISOString().slice(0, 10) }
        : {}),
    };

    let result: unknown;
    if (resolution.numberingRangeId) {
      result = await this.adapter.updateNumberingRange(
        resolution.numberingRangeId,
        { current: resolution.next ?? 0 },
      );
    } else {
      result = await this.adapter.createNumberingRange(payload);
    }

    const rangeId = resolution.numberingRangeId ?? extractRangeId(result);
    if (!rangeId) {
      throw new Error('Factus: no se pudo obtener el id del rango creado.');
    }

    await this.prisma.resolution.update({
      where: { id },
      data: {
        numberingRangeId: rangeId,
        documentCode,
        factusRangeData: result as Prisma.InputJsonValue,
      },
    });

    await this.audit
      .log({
        userId: actorId,
        action: AuditAction.UPDATE,
        entityType: 'Resolution',
        entityId: resolution.id,
        newValue: { numberingRangeId: rangeId },
      })
      .catch(() => {});
    return result;
  }
}
