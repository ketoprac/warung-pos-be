import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

// GET /products — list all with category name
router.get('/products', (_req: Request, res: Response) => {
  const products = db
    .prepare(
      `SELECT
        p.id,
        p.category_id AS categoryId,
        c.name AS categoryName,
        p.name,
        p.price,
        p.is_active AS isActive
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.name`,
    )
    .all()

  // Convert isActive from 0/1 to boolean
  const mapped = (products as Record<string, unknown>[]).map((p) => ({
    ...p,
    isActive: p.isActive === 1,
  }))

  res.json(mapped)
})

const createSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(100),
  price: z.number().int().positive('Price must be greater than 0'),
  categoryId: z.number().int().positive('Category is required'),
})

// POST /products — create
router.post('/products', (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const { name, price, categoryId } = parsed.data

  // Verify category exists
  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)
  if (!category) return res.status(400).json({ message: 'Category not found' })

  const result = db
    .prepare('INSERT INTO products (category_id, name, price) VALUES (?, ?, ?)')
    .run(categoryId, name, price)

  const product = db
    .prepare(
      `SELECT
        p.id,
        p.category_id AS categoryId,
        c.name AS categoryName,
        p.name,
        p.price,
        p.is_active AS isActive
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?`,
    )
    .get(result.lastInsertRowid) as Record<string, unknown>

  res.status(201).json({ ...product, isActive: product.isActive === 1 })
})

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  price: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
})

// PUT /products/:id — update
router.put('/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid product ID' })

  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ message: 'Product not found' })

  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const updates: string[] = []
  const values: unknown[] = []

  if (parsed.data.name !== undefined) {
    updates.push('name = ?')
    values.push(parsed.data.name)
  }
  if (parsed.data.price !== undefined) {
    updates.push('price = ?')
    values.push(parsed.data.price)
  }
  if (parsed.data.categoryId !== undefined) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(parsed.data.categoryId)
    if (!cat) return res.status(400).json({ message: 'Category not found' })
    updates.push('category_id = ?')
    values.push(parsed.data.categoryId)
  }
  if (parsed.data.isActive !== undefined) {
    updates.push('is_active = ?')
    values.push(parsed.data.isActive ? 1 : 0)
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
  }

  const product = db
    .prepare(
      `SELECT
        p.id,
        p.category_id AS categoryId,
        c.name AS categoryName,
        p.name,
        p.price,
        p.is_active AS isActive
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?`,
    )
    .get(id) as Record<string, unknown>

  res.json({ ...product, isActive: product.isActive === 1 })
})

// DELETE /products/:id
router.delete('/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid product ID' })

  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ message: 'Product not found' })

  db.prepare('DELETE FROM products WHERE id = ?').run(id)
  res.status(204).send()
})

export default router
