import express from 'express'
import cors from 'cors'
import authRoutes from './routes/auth.js'
import productRoutes from './routes/products.js'
import categoryRoutes from './routes/categories.js'
import transactionRoutes from './routes/transactions.js'

// Import db to trigger schema initialization
import './db.js'

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Mount routes under /api/v1
app.use('/api/v1', authRoutes)
app.use('/api/v1', productRoutes)
app.use('/api/v1', categoryRoutes)
app.use('/api/v1', transactionRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('Unhandled error:', err)
    res.status(500).json({ message: 'Internal server error' })
  },
)

app.listen(PORT, () => {
  console.log(`WarungPOS backend running on http://localhost:${PORT}`)
  console.log(`API base: http://localhost:${PORT}/api/v1`)
})

export default app
