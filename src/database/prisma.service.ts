import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: pg.Pool;

  public isConnected = false;

  constructor(configService: ConfigService) {
    const connectionString =
      configService.get<string>('DATABASE_URL') ??
      'postgresql://localhost:5432/copigrafica';

    const isCloud =
      connectionString.includes('supabase') ||
      connectionString.includes('sslmode=');
    const pool = new pg.Pool({
      connectionString,
      connectionTimeoutMillis: 5000,
      ...(isCloud ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const adapter = new PrismaPg(pool);

    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.isConnected = true;
      console.log(
        '✅ Base de datos PostgreSQL / Supabase conectada con éxito.',
      );
    } catch (error: any) {
      this.isConnected = false;
      console.warn(
        `⚠️ Base de datos Supabase no conectada: ${error?.message || error}. Actualiza la contraseña en backend/.env.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isConnected) {
      await this.$disconnect().catch(() => {});
    }
    await this.pool.end().catch(() => {});
  }
}
