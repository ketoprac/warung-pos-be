import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'warungpos-secret-dev'

export interface AuthUser {
  userId: string
  email: string
  role: 'ADMIN' | 'CASHIER'
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid token' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '24h' })
}
