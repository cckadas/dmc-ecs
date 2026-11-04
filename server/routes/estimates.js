import express from 'express'
import { customerEstimates, customerDraftEstimate } from '../estimates.js'

const router = express.Router()

const MAX_ITEMS = 200
const DATE = /^\d{4}-\d{2}-\d{2}$/


// =============================================
// GET /api/customer/estimates
// The signed-in customer's orders: ship dates, likely ranges, arrival, and
// plain-words notes. Never the reasons or the suppliers.
// =============================================
router.get('/', async (req, res) => {
  try {
    res.json({ estimates: await customerEstimates(req.caller.id) })
  } catch (error) {
    console.error('Customer estimates failed:', error.message)
    res.status(500).json({ error: 'Estimates are unavailable right now.' })
  }
})


// =============================================
// POST /api/customer/estimates/draft
// { items: [{ product_id, quantity }], deliveryLocationId?, requestedShipDate? }
// A quotation request or quotation's estimate, as if the down payment were
// made today.
// =============================================
router.post('/draft', async (req, res) => {
  const { items, deliveryLocationId, requestedShipDate } = req.body || {}

  const valid = Array.isArray(items)
    && items.length > 0
    && items.length <= MAX_ITEMS
    && items.every((item) => typeof item?.product_id === 'string' && Number(item?.quantity) >= 0)

  if (!valid) {
    return res.status(400).json({ error: 'Choose at least one product to estimate.' })
  }

  try {
    const estimate = await customerDraftEstimate(req.caller.id, {
      items: items.map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) || 0 })),
      deliveryLocationId: typeof deliveryLocationId === 'string' ? deliveryLocationId : null,
      requestedShipDate: typeof requestedShipDate === 'string' && DATE.test(requestedShipDate) ? requestedShipDate : null,
    })

    res.json({ estimate })
  } catch (error) {
    console.error('Draft estimate failed:', error.message)
    res.status(500).json({ error: 'Estimates are unavailable right now.' })
  }
})


export default router
