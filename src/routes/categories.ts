import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

// GET /categories — list all
router.get('/categories', (_req: Request, res: Response) => {
  const categories = db.prepare('SELECT id, name FROM categories ORDER BY name').all()
  res.json(categories)
})

const createSchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
})

// POST /categories — create
router.post('/categories', (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(parsed.data.name)
  const category = db
    .prepare('SELECT id, name FROM categories WHERE id = ?')
    .get(result.lastInsertRowid)

  res.status(201).json(category)
})

// DELETE /categories/:id — delete if no products attached
router.delete('/categories/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (isNaN(id)) return res.status(400).json({ message: 'Invalid category ID' })

  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(id)
  if (!category) return res.status(404).json({ message: 'Category not found' })

  const productCount = db
    .prepare('SELECT COUNT(*) as count FROM products WHERE category_id = ?')
    .get(id) as { count: number }

  if (productCount.count > 0) {
    return res.status(400).json({
      message: 'Cannot delete category with products attached',
    })
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  res.status(204).send()
})

export default router
