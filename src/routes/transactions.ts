import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import db from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

const createSchema = z.object({
  paymentMethod: z.enum(['CASH', 'QRIS']),
  totalAmount: z.number().int().positive(),
  amountTendered: z.number().int().positive().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().positive(),
        price: z.number().int().positive(),
      }),
    )
    .min(1, 'At least one item is required'),
})

const querySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD')
    .optional(),
  paymentMethod: z.enum(['CASH', 'QRIS']).optional(),
})

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}

// POST /transactions — create transaction with items
router.post('/transactions', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const { paymentMethod, totalAmount, amountTendered, items } = parsed.data

  if (paymentMethod === 'CASH' && amountTendered === undefined) {
    return res.status(400).json({ message: 'Amount tendered is required for cash payments' })
  }

  if (paymentMethod === 'CASH' && amountTendered! < totalAmount) {
    return res.status(400).json({ message: 'Amount tendered must be >= total' })
  }

  const txId = randomUUID()
  const cashierId = req.user!.userId

  const client = await db.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO transactions (id, cashier_id, total_amount, payment_method, amount_tendered)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        txId,
        cashierId,
        totalAmount,
        paymentMethod,
        paymentMethod === 'CASH' ? amountTendered : null,
      ],
    )

    const savedItems: Array<{
      id: string
      productId: number
      productName: string
      quantity: number
      unitPrice: number
    }> = []

    for (const item of items) {
      const itemId = randomUUID()
      await client.query(
        `INSERT INTO transaction_items (id, transaction_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [itemId, txId, item.productId, item.qty, item.price],
      )

      const prodResult = await client.query('SELECT name FROM products WHERE id = $1', [
        item.productId,
      ])

      savedItems.push({
        id: itemId,
        productId: item.productId,
        productName: prodResult.rows[0]?.name ?? 'Unknown',
        quantity: item.qty,
        unitPrice: item.price,
      })
    }

    await client.query('COMMIT')

    res.status(201).json({
      id: txId,
      cashierId,
      totalAmount,
      paymentMethod,
      amountTendered: paymentMethod === 'CASH' ? amountTendered : undefined,
      createdAt: new Date().toISOString(),
      items: savedItems,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// GET /transactions/today — daily summary with optional filters
router.get('/transactions/today', async (req: Request, res: Response) => {
  const hasFilters =
    req.query.startDate !== undefined ||
    req.query.endDate !== undefined ||
    req.query.paymentMethod !== undefined

  let startDate: string
  let endDate: string
  let paymentMethod: string | undefined

  if (hasFilters) {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message })
    }
    startDate = parsed.data.startDate ?? todayStr()
    endDate = parsed.data.endDate ?? todayStr()
    paymentMethod = parsed.data.paymentMethod
  } else {
    startDate = todayStr()
    endDate = todayStr()
    paymentMethod = undefined
  }

  const endDateExclusive = addOneDay(endDate)

  const conditions: string[] = ['created_at >= $1', 'created_at < $2']
  const params: (string | number)[] = [startDate, endDateExclusive]
  let paramIdx = 3

  if (paymentMethod) {
    conditions.push(`payment_method = $${paramIdx++}`)
    params.push(paymentMethod)
  }

  const whereClause = conditions.join(' AND ')

  const txResult = await db.query(
    `SELECT id, cashier_id AS "cashierId", total_amount AS "totalAmount",
            payment_method AS "paymentMethod", amount_tendered AS "amountTendered",
            created_at AS "createdAt"
     FROM transactions
     WHERE ${whereClause}
     ORDER BY created_at DESC`,
    params,
  )

  const transactions = txResult.rows as Array<{
    id: string
    cashierId: string
    totalAmount: number
    paymentMethod: string
    amountTendered: number | null
    createdAt: string
  }>

  const transactionsWithItems = []
  for (const tx of transactions) {
    const itemsResult = await db.query(
      `SELECT
        ti.id,
        ti.product_id AS "productId",
        p.name AS "productName",
        ti.quantity,
        ti.unit_price AS "unitPrice"
       FROM transaction_items ti
       LEFT JOIN products p ON p.id = ti.product_id
       WHERE ti.transaction_id = $1`,
      [tx.id],
    )

    transactionsWithItems.push({
      ...tx,
      amountTendered: tx.amountTendered ?? undefined,
      items: itemsResult.rows,
    })
  }

  const summaryResult = await db.query(
    `SELECT
      COALESCE(SUM(total_amount), 0) AS "totalRevenue",
      COUNT(*) AS count
     FROM transactions
     WHERE ${whereClause}`,
    params,
  )

  const summary = summaryResult.rows[0]

  res.json({
    transactions: transactionsWithItems,
    totalRevenue: Number(summary.totalRevenue),
    count: Number(summary.count),
  })
})

const listQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD')
    .optional(),
  paymentMethod: z.enum(['CASH', 'QRIS']).optional(),
  search: z.string().optional(),
  page: z
    .string()
    .regex(/^\d+$/, 'page must be a positive integer')
    .optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .optional(),
})

// GET /transactions — paginated list with search
router.get('/transactions', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message })
  }

  const startDate = parsed.data.startDate ?? todayStr()
  const endDate = parsed.data.endDate ?? todayStr()
  const endDateExclusive = addOneDay(endDate)
  const paymentMethod = parsed.data.paymentMethod
  const search = parsed.data.search?.trim() || undefined
  const page = Math.max(1, Number(parsed.data.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(parsed.data.limit) || 20))
  const offset = (page - 1) * limit

  const conditions: string[] = ['t.created_at >= $1', 't.created_at < $2']
  const params: (string | number)[] = [startDate, endDateExclusive]
  let paramIdx = 3

  if (paymentMethod) {
    conditions.push(`t.payment_method = $${paramIdx++}`)
    params.push(paymentMethod)
  }

  if (search) {
    conditions.push(
      `(t.id ILIKE $${paramIdx} OR t.id IN (SELECT ti.transaction_id FROM transaction_items ti JOIN products p ON p.id = ti.product_id WHERE p.name ILIKE $${paramIdx}))`,
    )
    params.push(`%${search}%`)
    paramIdx++
  }

  const whereClause = conditions.join(' AND ')

  // Count total matching rows
  const countResult = await db.query(
    `SELECT COUNT(*) AS "totalCount", COALESCE(SUM(t.total_amount), 0) AS "totalRevenue"
     FROM transactions t
     WHERE ${whereClause}`,
    params,
  )

  const totalCount = Number(countResult.rows[0].totalCount)
  const totalRevenue = Number(countResult.rows[0].totalRevenue)
  const totalPages = Math.ceil(totalCount / limit)

  // Fetch page of transactions (without items)
  const txResult = await db.query(
    `SELECT t.id, t.cashier_id AS "cashierId", t.total_amount AS "totalAmount",
            t.payment_method AS "paymentMethod", t.amount_tendered AS "amountTendered",
            t.created_at AS "createdAt"
     FROM transactions t
     WHERE ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset],
  )

  const transactions = txResult.rows as Array<{
    id: string
    cashierId: string
    totalAmount: number
    paymentMethod: string
    amountTendered: number | null
    createdAt: string
  }>

  // Attach items to each transaction
  const transactionsWithItems = []
  for (const tx of transactions) {
    const itemsResult = await db.query(
      `SELECT
        ti.id,
        ti.product_id AS "productId",
        p.name AS "productName",
        ti.quantity,
        ti.unit_price AS "unitPrice"
       FROM transaction_items ti
       LEFT JOIN products p ON p.id = ti.product_id
       WHERE ti.transaction_id = $1`,
      [tx.id],
    )

    transactionsWithItems.push({
      ...tx,
      amountTendered: tx.amountTendered ?? undefined,
      items: itemsResult.rows,
    })
  }

  res.json({
    transactions: transactionsWithItems,
    totalCount,
    totalRevenue,
    page,
    limit,
    totalPages,
  })
})

export default router
