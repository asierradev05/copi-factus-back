import {
  DocumentType,
  InvoiceStatus,
  PaymentMethod,
  ServiceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';

export class InMemoryStore {
  public customers: any[] = [];
  public serviceTypes: any[] = [];
  public services: any[] = [];
  public products: any[] = [];
  public invoices: any[] = [];
  public invoiceItems: any[] = [];
  public payments: any[] = [];
  public auditLogs: any[] = [];
  public companySettings: any = {
    id: 'default',
    name: 'Copigrafica Sierra',
    legalName: 'Copigrafica Sierra S.A.S.',
    invoicePrefix: 'FAC',
    invoiceNextNumber: 1001,
  };

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    this.serviceTypes.push({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Impresión Digital DEV',
      description: 'Servicios de impresión digital',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.customers.push({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Cliente Demo DEV',
      documentType: DocumentType.NIT,
      documentNumber: '900123456-1',
      phone: '+57 300 123 4567',
      email: 'cliente@copigrafica.dev',
      address: 'Calle 10 # 5-20',
      city: 'Bogotá',
      notes: 'Cliente demo',
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

export const globalStore = new InMemoryStore();
