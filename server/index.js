import 'dotenv/config'

import express from 'express'
import cors from 'cors'

import customersRouter from './routes/users.js'
import staffsRouter from './routes/staffs.js'
import purchaseOrderEmailRouter from './routes/emails.js'
import paymentProofRouter from './routes/payment.js'
import chatRouter from './routes/chat.js'
import estimatesRouter from './routes/estimates.js'
import { requireRole } from './auth.js'

const app = express()

const PORT = process.env.PORT || 5000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'


// =============================================
// MIDDLEWARE
// =============================================
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
)

app.use(express.json())


// =============================================
// ROUTES
//
// Each lists who can call it. These roles match the pages that use each route
// (client/src/components/layout/navigation.js).
// =============================================
app.use('/api/users', requireRole('admin', 'sales'), customersRouter)
app.use('/api/staffs', requireRole('admin'), staffsRouter)
app.use('/api/send-email', requireRole('admin', 'procurement'), purchaseOrderEmailRouter)
app.use('/api/send-payment-proof', requireRole('admin', 'procurement'), paymentProofRouter)
app.use('/api/customer/chat', requireRole('customer'), chatRouter)
app.use('/api/customer/estimates', requireRole('customer'), estimatesRouter)


// =============================================
// HEALTH CHECK
// =============================================
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'DMC ECS server is running',
  })
})


// =============================================
// START SERVER
// =============================================
app.listen(PORT, () => {
  console.log(`DMC ECS server running on http://localhost:${PORT}`)
})