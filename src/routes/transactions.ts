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

// POST /transactions — create transaction with items
router.post('/transactions', (req: Request, res: Response) => {
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

  const insertTx = db.prepare(
    `INSERT INTO transactions (id, cashier_id, total_amount, payment_method, amount_tendered)
     VALUES (?, ?, ?, ?, ?)`,
  )

  const insertItem = db.prepare(
    `INSERT INTO transaction_items (id, transaction_id, product_id, quantity, unit_price)
     VALUES (?, ?, ?, ?, ?)`,
  )

  const getProductName = db.prepare('SELECT name FROM products WHERE id = ?')

  // Use a transaction for atomicity
  const createAll = db.transaction(() => {
    insertTx.run(
      txId,
      cashierId,
      totalAmount,
      paymentMethod,
      paymentMethod === 'CASH' ? amountTendered : null,
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
      insertItem.run(itemId, txId, item.productId, item.qty, item.price)

      const prod = getProductName.get(item.productId) as { name: string } | undefined
      savedItems.push({
        id: itemId,
        productId: item.productId,
        productName: prod?.name ?? 'Unknown',
        quantity: item.qty,
        unitPrice: item.price,
      })
    }

    return savedItems
  })

  const savedItems = createAll()

  res.status(201).json({
    id: txId,
    cashierId,
    totalAmount,
    paymentMethod,
    amountTendered: paymentMethod === 'CASH' ? amountTendered : undefined,
    createdAt: new Date().toISOString(),
    items: savedItems,
  })
})

// GET /transactions/today — daily summary
router.get('/transactions/today', (_req: Request, res: Response) => {
  const today = new Date()
  const startOfDay = today.toISOString().slice(0, 10) // "2026-06-26"

  const transactions = db
    .prepare(
      `SELECT id, cashier_id AS cashierId, total_amount AS totalAmount,
              payment_method AS paymentMethod, amount_tendered AS amountTendered,
              created_at AS createdAt
       FROM transactions
       WHERE created_at >= ?
       ORDER BY created_at DESC`,
    )
    .all(startOfDay) as Array<{
    id: string
    cashierId: string
    totalAmount: number
    paymentMethod: string
    amountTendered: number | null
    createdAt: string
  }>

  // Fetch items for each transaction
  const getItems = db.prepare(
    `SELECT
      ti.id,
      ti.product_id AS productId,
      p.name AS productName,
      ti.quantity,
      ti.unit_price AS unitPrice
     FROM transaction_items ti
     LEFT JOIN products p ON p.id = ti.product_id
     WHERE ti.transaction_id = ?`,
  )

  const transactionsWithItems = transactions.map((tx) => ({
    ...tx,
    amountTendered: tx.amountTendered ?? undefined,
    items: getItems.all(tx.id),
  }))

  const summary = db
    .prepare(
      `SELECT
        COALESCE(SUM(total_amount), 0) AS totalRevenue,
        COUNT(*) AS count
       FROM transactions
       WHERE created_at >= ?`,
    )
    .get(startOfDay) as { totalRevenue: number; count: number }

  res.json({
    transactions: transactionsWithItems,
    totalRevenue: summary.totalRevenue,
    count: summary.count,
  })
})

export default router
