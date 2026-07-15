import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables.')
  }
  console.log('[DB] createPrismaClient: Initializing PG connection pool...')
  const pool = new Pool({ connectionString })
  
  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle pg client:', err)
  })
  
  console.log('[DB] createPrismaClient: Initializing PrismaPg adapter...')
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
