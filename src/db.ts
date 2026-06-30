import 'dotenv/config'
import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Run schema on startup
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
await pool.query(schema)

console.log('Database schema initialized')

export default pool
