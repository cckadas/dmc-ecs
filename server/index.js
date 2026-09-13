import 'dotenv/config'

import express from 'express'
import cors from 'cors'

import customersRouter from './routes/users.js'
import staffsRouter from './routes/staffs.js'
import purchaseOrderEmailRouter from './routes/emails.js'
import paymentProofRouter from './routes/payment.js'

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
// =============================================
app.use('/api/users', customersRouter)
app.use('/api/staffs', staffsRouter)
app.use('/api/send-email', purchaseOrderEmailRouter)
app.use('/api/send-payment-proof', paymentProofRouter)


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