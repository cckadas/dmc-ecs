import { supabase } from '../supabase'
import { authHeaders } from './apiAuth'
import { allRows, estimateDraft, estimateOrders, forCustomer, loadAllDeliveries, loadOpenDeliveries, loadStartingValues } from '../utils/estimateLoader'
import { startingDaysFrom, supplierHistories } from '../utils/estimateInputs'
import { blendStep } from '../utils/predictions'
import { scoreSuppliers } from '../utils/supplierScores'
import { isSimulated } from '../utils/simulated'

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
  return allRows(() => supabase.rpc('status_history_for_estimates'))
}


// Staff: predictions for several orders at once, with every order's history.
export async function loadEstimates(orders) {
  return estimateOrders(supabase, orders, await loadStatusHistory())
}


export async function predictOrders(orders) {
  return (await loadEstimates(orders)).predictions
}


// Staff: an order not placed yet, as if its down payment were made today, e.g.
// a quotation request being priced. items: [{ product_id, quantity }];
// customerId: whose request it is; containerSize: the container chosen, if any.
export async function previewEstimate({ items, deliveryLocationId, requestedShipDate, customerId = null, containerSize = null }) {
  return estimateDraft(supabase, { items, deliveryLocationId, requestedShipDate, customerId, containerSize, history: await loadStatusHistory() })
}


// Staff, for Add PO: each supplier's usual days from PO to delivery (its own
// deliveries blended with DMC's number, as in the estimates), and whether it's
// often late: by its delivery score, or by DMC staff's word while it has few.
export async function loadSupplierTimings(supplierIds) {
  const [starting, deliveries] = await Promise.all([
    loadStartingValues(supabase),
    loadAllDeliveries(supabase).catch(() => []),
  ])

  const histories = supplierHistories(deliveries)
  const scores = scoreSuppliers(deliveries, supplierIds)
  const defaults = startingDaysFrom(starting.settings)

  return Object.fromEntries(supplierIds.map((supplierId) => {
    const theirs = starting.startingSuppliers[supplierId]
    const startingLead = Number(theirs?.usual_lead_days) || defaults.supplier_lead
    const score = scores[supplierId]

    return [supplierId, {
      usualLeadDays: blendStep(histories[supplierId]?.leadDays || [], startingLead).typical,
      deliveries: score?.count || 0,
      lateCount: score?.lateCount || 0,
      averageDaysLate: score?.averageDaysLate || 0,
      scored: Boolean(score?.enough),
      often: score?.enough ? score.band?.tone !== 'good' : theirs?.late_frequency === 'often',
      // Its record includes made-up demo deliveries.
      simulated: Boolean(score?.deliveries?.some((delivery) => isSimulated(delivery.poNumber))),
    }]
  }))
}


// Staff, for Receiving: each supplier delivery not in yet, with when it should
// arrive, the cases still to come and their volume. Soonest first. The server's
// overdue alerts use the same (utils/estimateLoader.js).
export async function loadExpectedDeliveries() {
  return loadOpenDeliveries(supabase)
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
// containerSize: the quotation's container, if it has one.
export async function previewMyEstimate({ items, deliveryLocationId, requestedShipDate, containerSize = null }) {
  const { estimate } = await callServer('/draft', { items, deliveryLocationId, requestedShipDate, containerSize })
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

  // A customer gets the same customer-safe version the server sends.
  const { predictions } = await estimateOrders(supabase, [order], history)
  return { history: own, prediction: forStaff ? predictions[0] : forCustomer(predictions[0]) }
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
