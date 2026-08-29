import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface KanbanCard {
  id: string;
  label: string;
  number: string;
  customer: string;
  date?: Date | string | null;
  total?: number | null;
  status: string;
}

export interface KanbanColumn {
  key: 'quote' | 'purchase-order' | 'invoice' | 'delivery' | 'payment';
  title: string;
  cards: KanbanCard[];
}

export interface KanbanResponse {
  columns: KanbanColumn[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getKanban(period: 'week' | 'month' = 'month'): Promise<KanbanResponse> {
    const since = new Date();
    if (period === 'week') since.setDate(since.getDate() - 7);
    else since.setDate(since.getDate() - 30);

    try {
      const [quotes, purchaseOrders, invoices, deliveryOrders, payments] =
        await Promise.all([
          this.prisma.quote.findMany({
            where: { issueDate: { gte: since } },
            include: { customer: true },
            orderBy: { issueDate: 'desc' },
            take: 200,
          }),
          this.prisma.purchaseOrder.findMany({
            where: { issueDate: { gte: since } },
            include: { customer: true },
            orderBy: { issueDate: 'desc' },
            take: 200,
          }),
          this.prisma.invoice.findMany({
            where: { issueDate: { gte: since } },
            include: { customer: true },
            orderBy: { issueDate: 'desc' },
            take: 200,
          }),
          this.prisma.deliveryOrder.findMany({
            where: { scheduledAt: { gte: since } },
            include: { customer: true },
            orderBy: { scheduledAt: 'desc' },
            take: 200,
          }),
          this.prisma.payment.findMany({
            where: { paymentDate: { gte: since } },
            include: { customer: true },
            orderBy: { paymentDate: 'desc' },
            take: 200,
          }),
        ]);

      return {
        columns: [
          {
            key: 'quote',
            title: 'Cotizaciones',
            cards: quotes.map((q) => ({
              id: q.id,
              label: 'Cotización',
              number: q.quoteNumber,
              customer: q.customer?.name ?? 'Cliente',
              date: q.issueDate,
              total: Number(q.total),
              status: q.status,
            })),
          },
          {
            key: 'purchase-order',
            title: 'Órdenes de compra',
            cards: purchaseOrders.map((po) => ({
              id: po.id,
              label: 'Orden de compra',
              number: po.poNumber,
              customer: po.customer?.name ?? 'Cliente',
              date: po.issueDate,
              total: Number(po.total),
              status: po.status,
            })),
          },
          {
            key: 'invoice',
            title: 'Facturas',
            cards: invoices.map((inv) => ({
              id: inv.id,
              label: 'Factura',
              number: inv.invoiceNumber ?? 'Borrador',
              customer: inv.customer?.name ?? 'Cliente',
              date: inv.issueDate ?? inv.createdAt,
              total: Number(inv.total),
              status: inv.status,
            })),
          },
          {
            key: 'delivery',
            title: 'Entregas',
            cards: deliveryOrders.map((del) => ({
              id: del.id,
              label: 'Orden de entrega',
              number: del.doNumber,
              customer: del.customer?.name ?? 'Cliente',
              date: del.scheduledAt ?? del.deliveredAt,
              total: null,
              status: del.status,
            })),
          },
          {
            key: 'payment',
            title: 'Pagos',
            cards: payments.map((pay) => ({
              id: pay.id,
              label: 'Pago',
              number: pay.reference ?? pay.id,
              customer: pay.customer?.name ?? 'Cliente',
              date: pay.paymentDate,
              total: Number(pay.amount),
              status: pay.paymentMethod,
            })),
          },
        ],
      };
    } catch {
      return { columns: [] };
    }
  }
}
