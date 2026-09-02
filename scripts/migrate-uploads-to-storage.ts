import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const BUCKET = 'invoice-pdfs';
const apply = process.argv.includes('--apply');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  }

  const pool = new pg.Pool({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    ssl: process.env.DIRECT_URL?.includes('supabase')
      ? { rejectUnauthorized: false }
      : undefined,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const storage = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await prisma.invoiceUpload.findMany({
    select: { id: true, fileName: true, filePath: true },
  });

  let migrated = 0;
  for (const row of rows) {
    if (row.filePath?.startsWith(`${BUCKET}/`)) {
      continue;
    }
    const local =
      row.filePath?.startsWith('/uploads/') ||
      row.filePath?.startsWith('uploads/')
        ? path.join(
            process.cwd(),
            row.filePath.replace(/^\/?uploads\//, 'uploads/'),
          )
        : null;
    if (!local || !fs.existsSync(local)) {
      console.warn(`SKIP ${row.id}: no local file for ${row.filePath}`);
      continue;
    }
    const buffer = fs.readFileSync(local);
    const objectPath = `${BUCKET}/${row.fileName}`;
    if (apply) {
      const { error } = await storage.storage
        .from(BUCKET)
        .upload(objectPath, buffer, {
          upsert: true,
          contentType: 'application/pdf',
        });
      if (error) {
        console.error(`FAIL ${row.id}: ${error.message}`);
        continue;
      }
      await prisma.invoiceUpload.update({
        where: { id: row.id },
        data: { filePath: objectPath },
      });
    }
    console.log(
      `${apply ? 'MIGRATED' : 'DRY-RUN'}: ${row.id} -> ${objectPath} (${buffer.length} bytes)`,
    );
    migrated++;
  }

  console.log(
    `Total: ${migrated} filas ${apply ? 'migradas' : 'a migrar (usa --apply)'}`,
  );
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
