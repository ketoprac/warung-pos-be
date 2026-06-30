import { Router, Request, Response } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { signToken } from '../middleware/auth.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
})

router.post('/auth/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const { email, password } = parsed.data

  const result = await db.query(
    'SELECT id, email, password_hash, role FROM users WHERE email = $1',
    [email],
  )

  const user = result.rows[0] as
    | { id: string; email: string; password_hash: string; role: string }
    | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: 'Incorrect credentials' })
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role as 'ADMIN' | 'CASHIER',
  })

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  })
})

export default router
