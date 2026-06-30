import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'

const router = Router()

const SELECT_PRODUCT = `
  SELECT
    p.id,
    p.category_id AS "categoryId",
    c.name AS "categoryName",
    p.name,
    p.price,
    p.is_active AS "isActive"
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`

// GET /products — list all with category name
router.get('/products', authMiddleware, async (_req: Request, res: Response) => {
  const result = await db.query(`${SELECT_PRODUCT} ORDER BY p.name`)
  const mapped = result.rows.map((p) => ({
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
router.post('/products', authMiddleware, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const { name, price, categoryId } = parsed.data

  // Verify category exists
  const catResult = await db.query('SELECT id FROM categories WHERE id = $1', [categoryId])
  if (catResult.rows.length === 0) {
    return res.status(400).json({ message: 'Category not found' })
  }

  const insertResult = await db.query(
    'INSERT INTO products (category_id, name, price) VALUES ($1, $2, $3) RETURNING id',
    [categoryId, name, price],
  )

  const newId = insertResult.rows[0].id

  const productResult = await db.query(
    `${SELECT_PRODUCT} WHERE p.id = $1`,
    [newId],
  )

  const product = productResult.rows[0]
  res.status(201).json({ ...product, isActive: product.isActive === 1 })
})

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  price: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
})

// PUT /products/:id — update
router.put('/products/:id', authMiddleware, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid product ID' })

  const existing = await db.query('SELECT id FROM products WHERE id = $1', [id])
  if (existing.rows.length === 0) {
    return res.status(404).json({ message: 'Product not found' })
  }

  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const updates: string[] = []
  const values: unknown[] = []
  let paramIdx = 1

  if (parsed.data.name !== undefined) {
    updates.push(`name = $${paramIdx++}`)
    values.push(parsed.data.name)
  }
  if (parsed.data.price !== undefined) {
    updates.push(`price = $${paramIdx++}`)
    values.push(parsed.data.price)
  }
  if (parsed.data.categoryId !== undefined) {
    const cat = await db.query('SELECT id FROM categories WHERE id = $1', [
      parsed.data.categoryId,
    ])
    if (cat.rows.length === 0) {
      return res.status(400).json({ message: 'Category not found' })
    }
    updates.push(`category_id = $${paramIdx++}`)
    values.push(parsed.data.categoryId)
  }
  if (parsed.data.isActive !== undefined) {
    updates.push(`is_active = $${paramIdx++}`)
    values.push(parsed.data.isActive ? 1 : 0)
  }

  if (updates.length > 0) {
    await db.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      [...values, id],
    )
  }

  const productResult = await db.query(`${SELECT_PRODUCT} WHERE p.id = $1`, [id])
  const product = productResult.rows[0]
  res.json({ ...product, isActive: product.isActive === 1 })
})

// DELETE /products/:id
router.delete('/products/:id', authMiddleware, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid product ID' })

  const existing = await db.query('SELECT id FROM products WHERE id = $1', [id])
  if (existing.rows.length === 0) {
    return res.status(404).json({ message: 'Product not found' })
  }

  await db.query('DELETE FROM products WHERE id = $1', [id])
  res.status(204).send()
})

export default router
