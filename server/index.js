import 'dotenv/config'

import express from 'express'
import cors from 'cors'

import usersRouter from './routes/users.js'
import purchaseOrderEmailRouter from './routes/emails.js'

const app = express()

const PORT = process.env.PORT || 5000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// Middleware
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
)

app.use(express.json())

// Routes
app.use('/api/users', usersRouter)
app.use('/api/send-email',purchaseOrderEmailRouter)

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'DMC ECS server is running',
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`DMC ECS server running on http://localhost:${PORT}`)
})