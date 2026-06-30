import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'

const router = Router()

// GET /categories — list all
router.get('/categories', authMiddleware, async (_req: Request, res: Response) => {
  const result = await db.query('SELECT id, name FROM categories ORDER BY name')
  res.json(result.rows)
})

const createSchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
})

// POST /categories — create
router.post('/categories', authMiddleware, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const result = await db.query(
    'INSERT INTO categories (name) VALUES ($1) RETURNING id, name',
    [parsed.data.name],
  )

  res.status(201).json(result.rows[0])
})

// DELETE /categories/:id — delete if no products attached
router.delete('/categories/:id', authMiddleware, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid category ID' })

  const catResult = await db.query('SELECT id FROM categories WHERE id = $1', [id])
  if (catResult.rows.length === 0) {
    return res.status(404).json({ message: 'Category not found' })
  }

  const countResult = await db.query(
    'SELECT COUNT(*) as count FROM products WHERE category_id = $1',
    [id],
  )

  if (countResult.rows[0].count > 0) {
    return res.status(400).json({
      message: 'Cannot delete category with products attached',
    })
  }

  await db.query('DELETE FROM categories WHERE id = $1', [id])
  res.status(204).send()
})

export default router
