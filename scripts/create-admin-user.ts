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

const EMAIL = 'angel.sierra0507@gmail.com';
const FULL_NAME = 'Angel Sierra';
const ROLE = 'ADMIN' as const;
// Contraseña generada una sola vez; el usuario debe cambiarla tras su primer ingreso.
const PASSWORD = process.env.ADMIN_INITIAL_PASSWORD;

async function main() {
  if (!PASSWORD) {
    throw new Error('ADMIN_INITIAL_PASSWORD no está definido.');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.profile.findUnique({ where: { email: EMAIL } });

  if (existing) {
    const updated = await prisma.profile.update({
      where: { id: existing.id },
      data: {
        fullName: FULL_NAME,
        role: ROLE,
        isActive: true,
        passwordHash,
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
    console.log('USER_UPDATED', JSON.stringify(updated));
  } else {
    const created = await prisma.profile.create({
      data: {
        email: EMAIL,
        fullName: FULL_NAME,
        role: ROLE,
        isActive: true,
        passwordHash,
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
    console.log('USER_CREATED', JSON.stringify(created));
  }
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
