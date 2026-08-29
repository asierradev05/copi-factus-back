import { Injectable } from '@nestjs/common';
import { InvoiceStatus, ServiceStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../database/prisma.service';
import {
  SalesReportQueryDto,
  ServicesReportQueryDto,
} from './dto/report-query.dto';
import { AccountsReceivableService } from '../accounts-receivable/accounts-receivable.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsReceivableService: AccountsReceivableService,
  ) {}

  async getSalesReport(query: SalesReportQueryDto) {
    const where: {
      status: { notIn: InvoiceStatus[] };
      issueDate?: { gte?: Date; lte?: Date };
    } = {
      status: {
        notIn: [InvoiceStatus.BORRADOR, InvoiceStatus.CANCELADA],
      },
    };

    if (query.from || query.to) {
      where.issueDate = {};
      if (query.from) {
        where.issueDate.gte = new Date(query.from);
      }
      if (query.to) {
        where.issueDate.lte = new Date(query.to);
      }
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { customer: true, payments: true },
      orderBy: { issueDate: 'desc' },
    });

    let totalSales = new Decimal(0);
    let totalCollected = new Decimal(0);
    let totalPending = new Decimal(0);

    for (const invoice of invoices) {
      totalSales = totalSales.add(invoice.total);
      totalCollected = totalCollected.add(invoice.paidAmount);
      totalPending = totalPending.add(invoice.balance);
    }

    return {
      period: { from: query.from ?? null, to: query.to ?? null },
      invoiceCount: invoices.length,
      totalSales: totalSales.toFixed(2),
      totalCollected: totalCollected.toFixed(2),
      totalPending: totalPending.toFixed(2),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer.name,
        issueDate: inv.issueDate,
        total: inv.total.toFixed(2),
        paidAmount: inv.paidAmount.toFixed(2),
        balance: inv.balance.toFixed(2),
        status: inv.status,
      })),
    };
  }

  async getReceivablesReport() {
    return this.accountsReceivableService.getSummary();
  }

  async getServicesReport(query: ServicesReportQueryDto) {
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        where.createdAt.lte = new Date(query.to);
      }
    }

    const services = await this.prisma.service.findMany({
      where,
      include: { serviceType: true, customer: true },
    });

    const byStatus: Record<string, number> = {};
    let totalValue = new Decimal(0);

    for (const status of Object.values(ServiceStatus)) {
      byStatus[status] = 0;
    }

    for (const service of services) {
      byStatus[service.status] = (byStatus[service.status] ?? 0) + 1;
      totalValue = totalValue.add(service.total);
    }

    return {
      period: { from: query.from ?? null, to: query.to ?? null },
      totalServices: services.length,
      totalValue: totalValue.toFixed(2),
      byStatus,
      recentServices: services.slice(0, 10).map((s) => ({
        id: s.id,
        customer: s.customer.name,
        serviceType: s.serviceType.name,
        status: s.status,
        total: s.total.toFixed(2),
        requestedAt: s.requestedAt,
      })),
    };
  }
}
