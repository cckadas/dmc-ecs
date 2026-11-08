import { supabaseAdmin } from './supabaseAdmin.js'
import { allStatusHistory, loadShared } from './estimates.js'


// =============================================================================
// Prediction alerts
//
// Every hour the server checks the open orders' estimates and the supplier
// deliveries, and tells staff through the bell in the top bar when:
//   - an order may miss the customer's requested ship date  → sales, management
//   - an order has been in one step much longer than usual   → sales, management
//   - a supplier's delivery is overdue                       → procurement
//     (each supplier's part of each PO once; one notification per order)
//
// Each alert goes out once: the ones sent are kept in prediction_alerts
// (db/migrations/018). If the requested or promised date changes, that's a new
// alert. Customers never get these: their pages only say when the estimate is
// after the date they asked for, never why.
// =============================================================================

const HOUR = 60 * 60 * 1000
const FIRST_CHECK_AFTER = 60 * 1000          // a minute after the server starts

// The statuses of an order going through DMC's steps (payment check onward).
// Pending payment isn't one: nothing has started until the down payment.
const OPEN_STATUSES = new Set(['submitted', 'payment verified', 'procurement', 'warehouse preparation', 'ready for shipment'])

// Where each team opens an order alert (client/src/components/layout/navigation.js).
const ORDER_PAGES = { sales: '/customer-orders', management: '/executive-dashboard' }

const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
const formatDay = (value) => dayFormat.format(new Date(value))
const days = (count) => `${count} ${count === 1 ? 'day' : 'days'}`
const normalize = (status) => (status || '').trim().toLowerCase()
const chunks = (list, size = 50) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size))


// The open orders' problems: may miss the requested date, or stuck in a step:
// past its slow case, and at least a day longer than it usually takes.
function orderAlerts(predictions) {
  const alerts = []

  for (const prediction of predictions) {
    if (prediction.shipped || !prediction.estimatedShipDate) continue

    if (prediction.daysPastRequested > 0) {
      alerts.push({ key: `late:${prediction.id}:${prediction.requestedShipDate}`, kind: 'late', prediction })
    }

    const stuck = prediction.stuckStep
    if (stuck && stuck.days >= stuck.usualDays + 1) {
      alerts.push({ key: `stuck:${prediction.id}:${stuck.key}`, kind: 'stuck', prediction })
    }
  }

  return alerts
}


// Supplier deliveries a day or more past their promised date, for open orders.
function deliveryAlerts(deliveries, ordersById) {
  return deliveries
    .filter((delivery) => delivery.overdueDays >= 1 && ordersById.has(delivery.customerOrderId))
    .map((delivery) => ({
      key: `overdue:${delivery.purchaseOrderId}:${delivery.supplierId}:${delivery.promised}`,
      kind: 'overdue',
      delivery,
      order: ordersById.get(delivery.customerOrderId),
    }))
}


// One notification per order and team, with everything new about that order.
function orderNotifications(alerts) {
  const byOrder = new Map()
  for (const alert of alerts) {
    if (!byOrder.has(alert.prediction.id)) byOrder.set(alert.prediction.id, [])
    byOrder.get(alert.prediction.id).push(alert)
  }

  return [...byOrder.values()].flatMap((group) => {
    const prediction = group[0].prediction
    const late = group.some((alert) => alert.kind === 'late')
    const stuck = group.some((alert) => alert.kind === 'stuck') ? prediction.stuckStep : null
    const orderNumber = prediction.order_number || 'An order'
    const lines = []

    if (late) {
      lines.push(`Estimated to ship around ${formatDay(prediction.estimatedShipDate)}, ${days(prediction.daysPastRequested)} after the customer's requested date (${formatDay(prediction.requestedShipDate)}).`)
    }
    if (stuck) {
      const usual = stuck.usualDays < 1 ? 'under a day' : `about ${days(stuck.usualDays)}`
      lines.push(`It has been at the ${stuck.label.toLowerCase()} step for ${days(stuck.days)}; this usually takes ${usual}.`)
      if (!late) lines.push(`Estimated to ship around ${formatDay(prediction.estimatedShipDate)}.`)
    }
    for (const supplier of prediction.overdueSuppliers || []) {
      lines.push(`${supplier.name}'s delivery is ${days(supplier.days)} overdue.`)
    }
    if (prediction.roughEstimate) lines.push('A rough estimate: there are few finished orders to learn from yet.')
    if (late) lines.push('Let the customer know, or agree on a later date.')

    return Object.entries(ORDER_PAGES).map(([role, link]) => ({
      user_id: prediction.customer_id,
      role,
      title: late ? `${orderNumber} may miss its requested ship date` : `${orderNumber} is taking longer than usual`,
      message: lines.join(' '),
      type: 'warning',
      link,
      related_customer_order_id: prediction.id,
    }))
  })
}


// One notification per order for procurement, with its newly overdue deliveries,
// most overdue first.
function deliveryNotifications(alerts) {
  const byOrder = new Map()
  for (const alert of alerts) {
    if (!byOrder.has(alert.order.id)) byOrder.set(alert.order.id, [])
    byOrder.get(alert.order.id).push(alert.delivery)
  }

  const cases = (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'case' : 'cases'}`

  return [...byOrder.entries()].map(([orderId, deliveries]) => {
    const order = alerts.find((alert) => alert.order.id === orderId).order
    const orderNumber = order.order_number || 'an order'
    deliveries.sort((a, b) => b.overdueDays - a.overdueDays || String(a.poNumber).localeCompare(String(b.poNumber)))
    const first = deliveries[0]

    const notification = {
      user_id: order.customer_id,
      role: 'procurement',
      type: 'warning',
      link: '/purchase-orders',
      related_customer_order_id: order.id,
      related_purchase_order_id: first.purchaseOrderId,
    }

    if (deliveries.length === 1) {
      return {
        ...notification,
        title: `${first.poNumber}: ${first.supplierName}'s delivery is ${days(first.overdueDays)} overdue`,
        message: `It was promised for ${formatDay(first.promised)}, with ${cases(first.cases)} still to come for ${orderNumber}. Follow up with ${first.supplierName}.`,
      }
    }

    const shown = deliveries.slice(0, 3).map((delivery) =>
      `${delivery.poNumber} from ${delivery.supplierName} (${days(delivery.overdueDays)} overdue, ${cases(delivery.cases)})`)
    const more = deliveries.length - shown.length

    return {
      ...notification,
      title: `${order.order_number || first.poNumber}: ${deliveries.length} supplier deliveries are overdue`,
      message: `${shown.join('; ')}${more ? `; and ${more} more on the Purchase Orders page` : ''}. Follow up with the suppliers.`,
    }
  })
}


// Marks the alerts as sent. Only the ones not sent before come back, so two
// checks at once can't both send the same alert.
async function claim(client, alerts) {
  const rows = alerts.map((alert) => ({
    key: alert.key,
    customer_order_id: alert.prediction?.id || alert.order?.id || null,
    purchase_order_id: alert.delivery?.purchaseOrderId || null,
  }))

  const { data, error } = await client
    .from('prediction_alerts')
    .upsert(rows, { onConflict: 'key', ignoreDuplicates: true })
    .select('key')

  if (error) throw error

  return new Set((data || []).map((row) => row.key))
}


// For a trial run: the alerts not sent before, without marking anything.
async function notSentYet(client, alerts) {
  const keys = alerts.map((alert) => alert.key)
  const sent = new Set()

  for (const part of chunks(keys)) {
    const { data, error } = await client.from('prediction_alerts').select('key').in('key', part)
    if (!error) (data || []).forEach((row) => sent.add(row.key))
  }

  return new Set(keys.filter((key) => !sent.has(key)))
}


async function release(client, keys) {
  for (const part of chunks(keys)) {
    await client.from('prediction_alerts').delete().in('key', part)
  }
}


// One check: works out what's new and sends it. Returns the notifications sent.
// dryRun: returns what would be sent, and changes nothing.
export async function checkPredictionAlerts({ client = supabaseAdmin, dryRun = false } = {}) {
  const { allRows, estimateOrders, loadOpenDeliveries } = await loadShared()

  const orders = await allRows(() => client
    .from('customer_orders')
    .select('id, order_number, customer_id, status, created_at, requested_ship_date, delivery_location_id')
    .order('id'))

  const open = (orders || []).filter((order) => OPEN_STATUSES.has(normalize(order.status)))
  if (!open.length) return []

  const [history, deliveries] = await Promise.all([allStatusHistory(client), loadOpenDeliveries(client)])
  const { predictions } = await estimateOrders(client, open, history)

  const ordersById = new Map(open.map((order) => [order.id, order]))
  const alerts = [...orderAlerts(predictions), ...deliveryAlerts(deliveries, ordersById)]
    .filter((alert) => (alert.prediction || alert.order).customer_id)

  if (!alerts.length) return []

  const fresh = dryRun ? await notSentYet(client, alerts) : await claim(client, alerts)
  const newAlerts = alerts.filter((alert) => fresh.has(alert.key))

  const notifications = [
    ...orderNotifications(newAlerts.filter((alert) => alert.prediction)),
    ...deliveryNotifications(newAlerts.filter((alert) => alert.delivery)),
  ]

  if (dryRun || !notifications.length) return notifications

  const { error: sendError } = await client.from('notifications').insert(notifications)

  if (sendError) {
    // Not sent: unmark them so the next check tries again.
    await release(client, [...fresh])
    throw sendError
  }

  return notifications
}


const isMissingTable = (error) =>
  ['42P01', 'PGRST205'].includes(error?.code) || /could not find the table/i.test(error?.message || '')

let waitingNoted = false

// Starts the hourly check. PREDICTION_ALERTS=off in server/.env turns it off.
export function startPredictionAlerts() {
  if (normalize(process.env.PREDICTION_ALERTS) === 'off') {
    console.log('Prediction alerts are off (PREDICTION_ALERTS=off).')
    return
  }

  let running = false

  const run = async () => {
    if (running) return
    running = true

    try {
      const sent = await checkPredictionAlerts()
      if (sent.length) console.log(`Prediction alerts: sent ${sent.length} ${sent.length === 1 ? 'notification' : 'notifications'}.`)
    } catch (error) {
      if (isMissingTable(error)) {
        if (!waitingNoted) console.warn('Prediction alerts are waiting for db/migrations/018_prediction_alerts.sql to be run in Supabase.')
        waitingNoted = true
      } else {
        console.error('Prediction alerts check failed:', error?.message || error)
      }
    } finally {
      running = false
    }
  }

  setTimeout(run, FIRST_CHECK_AFTER).unref()
  setInterval(run, HOUR).unref()
}
