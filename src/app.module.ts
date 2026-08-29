import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './database/prisma.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { ServicesModule } from './services/services.module';
import { ProductsModule } from './products/products.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { AccountsReceivableModule } from './accounts-receivable/accounts-receivable.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { RecurringServicesModule } from './recurring-services/recurring-services.module';
import { InvoiceUploadsModule } from './invoice-uploads/invoice-uploads.module';
import { QuotesModule } from './quotes/quotes.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { DeliveryOrdersModule } from './delivery-orders/delivery-orders.module';
import { ResolutionsModule } from './resolutions/resolutions.module';
import { ReceivedDocumentsModule } from './received-documents/received-documents.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SupabaseModule } from './common/supabase/supabase.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    SupabaseModule,
    UsersModule,
    CustomersModule,
    ServicesModule,
    ProductsModule,
    InvoicesModule,
    PaymentsModule,
    AccountsReceivableModule,
    ReportsModule,
    AuditModule,
    SettingsModule,
    RecurringServicesModule,
    InvoiceUploadsModule,
    QuotesModule,
    PurchaseOrdersModule,
    DeliveryOrdersModule,
    ResolutionsModule,
    ReceivedDocumentsModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
