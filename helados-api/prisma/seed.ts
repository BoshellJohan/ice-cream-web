import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: 'admin@helados.com' } });
  if (existing) return;

  await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@helados.com',
      passwordHash: await bcrypt.hash('admin1234', 10),
      role: 'ADMIN',
    },
  });
  console.log('Seeded: admin@helados.com / admin1234');
}

main().finally(() => prisma.$disconnect());
