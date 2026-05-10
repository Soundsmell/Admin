import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

const databaseUrl = process.env.DATABASE_URL

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null

export const db = pool ? drizzle(pool) : null
