// =============================================================================
// Estimate inputs — shaping database rows for utils/predictions.js
//
// Turns the rows an estimate needs (the order's items and purchase orders, and
// every supplier's past deliveries) into the context that predictOrder takes.
// Everything comes from the system's own records. The website's staff pages
// and DMC's server both use it, so an order gets the same estimate everywhere.
// The callers load the rows.
//
// Imports carry their .js extension so the server (Node) can load this too.
// =============================================================================

import { MIN_RECORDS, blendStep, normalizeStatus } from './predictions.js'
import { manilaDate, SCORE_WINDOW_DAYS } from './supplierScores.js'
import { isBigContainer } from './labelingKind.js'
import { countryName, nearestCountry } from './countryPlaces.js'

const DAY = 1000 * 60 * 60 * 24

// Busy months are found from POs sent at least this long ago: for newer ones,
// only the quick deliveries are in yet, which would make the month look quick.
export const SETTLED_PO_DAYS = 60
// ...and over the last two years, so a month has last year's deliveries too.
const BUSY_MONTH_WINDOW_DAYS = 730


// Each supplier's deliveries from the last 12 months (utils/supplierScores.js's
// buildDeliveries), as lead times and how late each was.
export function supplierHistories(deliveries = [], today = new Date()) {
  const since = manilaDate(today.getTime() - SCORE_WINDOW_DAYS * DAY)
  const histories = {}

  for (const delivery of deliveries) {
    if (delivery.receivedOn < since) continue
    if (!histories[delivery.supplierId]) histories[delivery.supplierId] = { leadDays: [], lateness: [] }
    if (delivery.leadDays >= 0) histories[delivery.supplierId].leadDays.push(delivery.leadDays)
    if (delivery.lateness !== null) histories[delivery.supplierId].lateness.push(delivery.lateness)
  }

  return histories
}


// Every supplier's deliveries from the last 12 months together: what a supplier
// with few deliveries of its own leans on. And, by the month each PO went out,
// what the busy months are found from: POs of the last two years, sent at
// least SETTLED_PO_DAYS ago.
export function supplierPool(deliveries = [], today = new Date()) {
  const since = manilaDate(today.getTime() - SCORE_WINDOW_DAYS * DAY)
  const monthsSince = manilaDate(today.getTime() - BUSY_MONTH_WINDOW_DAYS * DAY)
  const settledBy = manilaDate(today.getTime() - SETTLED_PO_DAYS * DAY)
  const pool = { leadDays: [], lateness: [], leadByMonth: [] }

  for (const delivery of deliveries) {
    const settled = delivery.orderedOn && delivery.orderedOn >= monthsSince && delivery.orderedOn <= settledBy
    if (delivery.leadDays >= 0 && settled) {
      pool.leadByMonth.push({ month: Number(String(delivery.orderedOn).slice(5, 7)), days: delivery.leadDays })
    }

    if (delivery.receivedOn < since) continue
    if (delivery.leadDays >= 0) pool.leadDays.push(delivery.leadDays)
    if (delivery.lateness !== null && delivery.lateness !== undefined) pool.lateness.push(delivery.lateness)
  }

  return pool
}


// Days at sea of every container whose arrival was recorded (db/migrations/025):
// from the day it shipped (its last change to shipped, in the Philippines) to
// the day it arrived, with the country it went to.
//   orders:    [{ id, delivery_location_id, arrived_on }]  the arrived ones
//   locations: [{ id, country }]
//   history:   status changes
export function sailingRecords({ orders = [], locations = [], history = [] }) {
  const countryOf = Object.fromEntries(locations.map((location) => [location.id, location.country]))
  const shippedAt = {}

  for (const entry of history) {
    if (normalizeStatus(entry.new_status) !== 'shipped') continue
    const time = Date.parse(entry.changed_at)
    if (!(shippedAt[entry.customer_order_id] >= time)) shippedAt[entry.customer_order_id] = time
  }

  const records = []
  for (const order of orders) {
    const country = countryOf[order.delivery_location_id]
    const shipped = shippedAt[order.id]
    if (!order.arrived_on || !country || !shipped) continue

    const days = Math.round((Date.parse(String(order.arrived_on).slice(0, 10)) - Date.parse(manilaDate(shipped))) / DAY)
    if (days >= 0) records.push({ orderId: order.id, country, days })
  }

  return records
}


// The days at sea to a country, from recorded arrivals: its own once it has
// MIN_RECORDS of them; until then, leaning on the nearest country that has
// enough (its own n count for n ÷ (n + 5)). Null with nothing close to go by.
// nearest: the country it leaned on, if any.
export function sailingFor(records = [], country) {
  const name = countryName(country)
  if (!name) return null

  const byCountry = new Map()
  for (const record of records) {
    const key = countryName(record.country)
    if (!byCountry.has(key)) byCountry.set(key, { country: String(record.country).trim(), days: [] })
    byCountry.get(key).days.push(record.days)
  }

  const own = byCountry.get(name)?.days || []
  if (own.length >= MIN_RECORDS) {
    const span = blendStep(own)
    return { typical: span.typical, quick: span.quick, slow: span.slow, count: own.length, nearest: null }
  }

  const withEnough = [...byCountry.entries()]
    .filter(([key, entry]) => key !== name && entry.days.length >= MIN_RECORDS)
    .map(([, entry]) => entry.country)
  const near = nearestCountry(country, withEnough)
  if (!near) return null

  const span = blendStep(own, byCountry.get(countryName(near.country)).days)
  return span ? { typical: span.typical, quick: span.quick, slow: span.slow, count: own.length, nearest: near.country } : null
}


// One order's suppliers: those of its products, and of its purchase orders.
//   items          [{ products: { supplier_id } }]
//   purchaseOrders [{ id, expected_delivery_date }]  this order's POs
//   poLines        [{ purchase_order_id, supplier_id, fully_received_at }]
//   names          { supplier_id: name }
export function orderSuppliers({ items = [], purchaseOrders = [], poLines = [], histories = {}, names = {} }) {
  const orderIds = new Set(purchaseOrders.map((order) => order.id))
  const lines = poLines.filter((line) => orderIds.has(line.purchase_order_id))

  const supplierIds = new Set([
    ...items.map((item) => item.products?.supplier_id).filter(Boolean),
    ...lines.map((line) => line.supplier_id).filter(Boolean),
  ])

  return [...supplierIds].map((supplierId) => {
    const theirLines = lines.filter((line) => line.supplier_id === supplierId)
    const theirOrders = purchaseOrders.filter((order) => theirLines.some((line) => line.purchase_order_id === order.id))
    const received = theirLines.length > 0 && theirLines.every((line) => line.fully_received_at)

    // A supplier on more than one PO for this order delivers by the latest promise.
    const promised = theirOrders.map((order) => order.expected_delivery_date).filter(Boolean).sort().at(-1) || null

    // What's ordered from it (its PO lines, else the order's products from it),
    // and when its PO went out, for the model.
    const theirItems = items.filter((item) => item.products?.supplier_id === supplierId)
    const quantities = theirLines.length
      ? theirLines.map((line) => Number(line.ordered_quantity) || 0)
      : theirItems.map((item) => Number(item.quantity) || 0)
    const sentAt = theirOrders.map((order) => order.created_at).filter(Boolean).sort()[0]

    return {
      supplierId,
      name: names[supplierId] || 'A supplier',
      cases: quantities.reduce((total, quantity) => total + quantity, 0),
      products: quantities.length || 1,
      orderedOn: sentAt ? manilaDate(sentAt) : null,
      // No PO for this supplier yet: it's still to be ordered from.
      promised: theirLines.length ? promised : null,
      ordered: theirLines.length > 0,
      receivedOn: received
        ? manilaDate(Math.max(...theirLines.map((line) => Date.parse(line.fully_received_at))))
        : null,
      history: histories[supplierId] || { leadDays: [], lateness: [] },
    }
  })
}


// Cases ordered, for the labeling model. Order lines are in cases.
export const casesIn = (items = []) => items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)


// Everything predictOrder's context needs for one order. Missing pieces just
// leave that part to the status history. labelingKind: utils/labelingKind.js's;
// containerSize: the container code, when it isn't on the order (a draft);
// sailing: the days at sea to the order's country, from recorded arrivals;
// labelSteps: from the labels' saved steps (utils/labelingSteps.js).
export function estimateContext({ order, items, purchaseOrders, poLines, histories, pool = null, supplierNames, sailing = null, country, now, models = null, labelingKind = null, containerSize = null, labelSteps = null }) {
  const shipped = normalizeStatus(order?.status) === 'shipped'

  return {
    now,
    supplierPool: pool || {},
    sailing,
    cases: casesIn(items),
    products: (items || []).length,
    countryName: country || '',
    labelingKind,
    labelSteps,
    bigContainer: isBigContainer(containerSize || order?.container_size),
    models,
    suppliers: shipped ? [] : orderSuppliers({
      items,
      purchaseOrders,
      poLines,
      histories,
      names: supplierNames,
    }),
  }
}
