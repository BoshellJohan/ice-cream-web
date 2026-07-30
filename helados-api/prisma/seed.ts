import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@helados.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'Falta SEED_ADMIN_PASSWORD. Defínela en helados-api/.env (ver .env.example) antes de ejecutar el seed.',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'ADMIN',
      },
    });
    console.log(`Seeded: ${email} (contraseña tomada de SEED_ADMIN_PASSWORD)`);
  }

  await prisma.toppingTypeConfig.upsert({
    where: { type: 'NORMAL' },
    create: { type: 'NORMAL', unitPrice: 0 },
    update: {},
  });
  await prisma.toppingTypeConfig.upsert({
    where: { type: 'PREMIUM' },
    create: { type: 'PREMIUM', unitPrice: 0 },
    update: {},
  });
  console.log('Seeded: ToppingTypeConfig (NORMAL, PREMIUM)');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
