import { supabase } from '../supabase'
import { authHeaders } from './apiAuth'
import { estimateDraft, estimateOrders } from '../utils/estimateLoader'

export { ORDER_STATUS_FLOW, normalizeStatus, buildStageStatistics, predictOrder } from '../utils/predictions'


// =============================================================================
// Shipment predictions — loading the data
//
// The maths lives in utils/predictions.js and the loading in
// utils/estimateLoader.js, both shared with DMC's server, so an order gets the
// same estimate everywhere.
//
// Staff estimates are worked out here in the browser: staff can read DMC's
// starting values, the order's purchase orders and the suppliers' deliveries. A
// customer can read none of those, so their estimates come from the server
// (server/routes/estimates.js), which returns only the dates and plain words.
// =============================================================================

const API = `${import.meta.env.VITE_SERVER_URL}/api`

const byTime = (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()


// Every recorded status change, oldest first. Estimates learn from all orders'
// timings, which a customer can't read directly, so this comes from the database
// with other customers' order IDs hidden (db/migrations/013).
export async function loadStatusHistory() {
  const { data, error } = await supabase.rpc('status_history_for_estimates')

  if (error) throw error

  return data || []
}


// Staff: predictions for several orders at once, with every order's history.
export async function loadEstimates(orders) {
  return estimateOrders(supabase, orders, await loadStatusHistory())
}


export async function predictOrders(orders) {
  return (await loadEstimates(orders)).predictions
}


// Staff: an order not placed yet, as if its down payment were made today, e.g.
// a quotation request being priced. items: [{ product_id, quantity }]
export async function previewEstimate({ items, deliveryLocationId, requestedShipDate }) {
  return estimateDraft(supabase, { items, deliveryLocationId, requestedShipDate, history: await loadStatusHistory() })
}


// Calls DMC's server for a customer's estimates.
async function callServer(path, body) {
  const headers = await authHeaders()

  if (!headers.Authorization) throw new Error('Your session has ended. Please sign in again.')

  const response = await fetch(`${API}/customer/estimates${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) throw new Error(result.error || 'Estimates are unavailable right now.')

  return result
}


// Customer: their own orders' estimates, by order id.
export async function loadMyEstimates() {
  const { estimates } = await callServer('')
  return Object.fromEntries((estimates || []).map((estimate) => [estimate.orderId, estimate]))
}


// Customer: a quotation request or quotation's estimate, as if paid today.
export async function previewMyEstimate({ items, deliveryLocationId, requestedShipDate }) {
  const { estimate } = await callServer('/draft', { items, deliveryLocationId, requestedShipDate })
  return estimate
}


// Everything the progress tracker needs for one order: its own status changes
// (for the step dates) and its prediction. A customer's prediction comes from
// the server; if the server can't be reached, from the browser's partial view.
export async function loadOrderProgress(order, { forStaff = true } = {}) {
  const history = await loadStatusHistory()
  const own = history.filter((entry) => entry.customer_order_id === order.id).sort(byTime)

  if (!forStaff) {
    try {
      const estimates = await loadMyEstimates()
      if (estimates[order.id]) return { history: own, prediction: estimates[order.id] }
    } catch (error) {
      console.error('Server estimate unavailable, estimating in the browser:', error)
    }
  }

  const { predictions } = await estimateOrders(supabase, [order], history)
  return { history: own, prediction: predictions[0] }
}


// Records a status change for the tracker's dates and future predictions.
// A failure here never undoes the change itself.
export async function recordStatusChange(customerOrderId, previousStatus, newStatus) {
  try {
    const { error } = await supabase
      .from('customer_order_status_history')
      .insert({
        customer_order_id: customerOrderId,
        previous_status: previousStatus,
        new_status: newStatus,
        changed_at: new Date().toISOString(),
      })

    if (error) throw error
  } catch (error) {
    console.error('Failed to record status change:', error)
  }
}
