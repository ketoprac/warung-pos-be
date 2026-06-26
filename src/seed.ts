import db from './db.js'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'

// Only seed if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
if (userCount.count > 0) {
  console.log('Database already seeded. Skipping.')
  process.exit(0)
}

console.log('Seeding database...')

const adminId = randomUUID()
const cashierId = randomUUID()
const passwordHash = bcrypt.hashSync('password123', 10)

// Insert users
db.prepare(
  'INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)',
).run(adminId, 'admin@warung.com', passwordHash, 'ADMIN')

db.prepare(
  'INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)',
).run(cashierId, 'cashier@warung.com', passwordHash, 'CASHIER')

console.log('  Created users: admin@warung.com, cashier@warung.com (password: password123)')

// Insert categories
const catResult = db.prepare('INSERT INTO categories (name) VALUES (?)')
const drinksId = catResult.run('Drinks').lastInsertRowid as number
const foodId = catResult.run('Food').lastInsertRowid as number

console.log(`  Created categories: Drinks (${drinksId}), Food (${foodId})`)

// Insert sample products
const insertProduct = db.prepare(
  'INSERT INTO products (category_id, name, price) VALUES (?, ?, ?)',
)

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
  insertProduct.run(catId, name, price)
}

console.log(`  Created ${products.length} products`)

console.log('Seeding complete!')
process.exit(0)
