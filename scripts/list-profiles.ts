import 'dotenv/config';
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
    select: { email: true, role: true, isActive: true, passwordHash: true },
    orderBy: { role: 'asc' },
  });
  console.log(JSON.stringify(profiles, null, 2));
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
