import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  ssl: process.env.DIRECT_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const profiles = await prisma.profile.findMany({
    select: { id: true, email: true, role: true },
  });
  const password = process.env.DEV_PASSWORD ?? 'Admin123!';
  const hash = await bcrypt.hash(password, 10);

  for (const p of profiles) {
    await prisma.profile.update({
      where: { id: p.id },
      data: { passwordHash: hash },
    });
    console.log(`Set password hash for ${p.email} (${p.role})`);
  }
  console.log('Backfill complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
