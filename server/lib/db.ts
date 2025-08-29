import { PrismaClient } from '@prisma/client'

// Ensure DATABASE_URL is set with fallback
const databaseUrl = process.env.DATABASE_URL || 'file:./database.db';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
