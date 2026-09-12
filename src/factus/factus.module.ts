import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FactusAuthService } from './factus-auth.service';
import { FactusAdapterService } from './factus-adapter.service';
import { FactusSyncService } from './factus-sync.service';
import { FactusEmissionService } from './factus-emission.service';
import { FactusController } from './factus.controller';

@Module({
  imports: [AuditModule],
  controllers: [FactusController],
  providers: [
    FactusAuthService,
    FactusAdapterService,
    FactusSyncService,
    FactusEmissionService,
  ],
  exports: [FactusAuthService, FactusAdapterService, FactusEmissionService],
})
export class FactusModule {}
