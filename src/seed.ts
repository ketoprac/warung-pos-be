import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Run schema first
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
await pool.query(schema)
console.log('Schema initialized')

// Only seed if no users exist
const userResult = await pool.query('SELECT COUNT(*) as count FROM users')
const userCount = Number(userResult.rows[0].count)

if (userCount > 0) {
  console.log('Database already seeded. Skipping.')
  await pool.end()
  process.exit(0)
}

console.log('Seeding database...')

const adminId = randomUUID()
const cashierId = randomUUID()
const passwordHash = bcrypt.hashSync('password123', 10)

// Insert users
await pool.query(
  'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)',
  [adminId, 'admin@warung.com', passwordHash, 'ADMIN'],
)

await pool.query(
  'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)',
  [cashierId, 'cashier@warung.com', passwordHash, 'CASHIER'],
)

console.log('  Created users: admin@warung.com, cashier@warung.com (password: password123)')

// Insert categories
const drinksResult = await pool.query(
  "INSERT INTO categories (name) VALUES ('Drinks') RETURNING id",
)
const drinksId = drinksResult.rows[0].id

const foodResult = await pool.query(
  "INSERT INTO categories (name) VALUES ('Food') RETURNING id",
)
const foodId = foodResult.rows[0].id

console.log(`  Created categories: Drinks (${drinksId}), Food (${foodId})`)

// Insert sample products
const products = [
  [drinksId, 'Kopi Susu', 18000],
  [drinksId, 'Teh Manis', 8000],
  [drinksId, 'Es Jeruk', 10000],
  [foodId, 'Nasi Goreng', 25000],
  [foodId, 'Mie Goreng', 20000],
  [foodId, 'Ayam Goreng', 22000],
  [foodId, 'Sate Ayam', 28000],
  [drinksId, 'Americano', 15000],
] as const

for (const [catId, name, price] of products) {
  await pool.query(
    'INSERT INTO products (category_id, name, price) VALUES ($1, $2, $3)',
    [catId, name, price],
  )
}

console.log(`  Created ${products.length} products`)

console.log('Seeding complete!')
await pool.end()
process.exit(0)
