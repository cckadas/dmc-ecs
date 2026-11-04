// =============================================================================
// Estimate inputs — shaping database rows for utils/predictions.js
//
// Turns the rows an estimate needs (DMC's starting values, the order's items
// and purchase orders, each supplier's past deliveries) into the context that
// predictOrder takes. The website's staff pages and DMC's server both use it,
// so an order gets the same estimate everywhere. The callers load the rows.
//
// Imports carry their .js extension so the server (Node) can load this too.
// =============================================================================

import { DEFAULT_STARTING_DAYS, normalizeStatus } from './predictions.js'
import { manilaDate, SCORE_WINDOW_DAYS } from './supplierScores.js'

const DAY = 1000 * 60 * 60 * 24
const countryKey = (country) => (country || '').trim().toLowerCase()


// prediction_settings rows ({ key, days }) over the built-in placeholders.
export function startingDaysFrom(rows = []) {
  const starting = { ...DEFAULT_STARTING_DAYS }
  for (const row of rows) {
    if (row.key in starting && row.days !== null && row.days !== undefined) starting[row.key] = Number(row.days)
  }
  return starting
}


// prediction_busy_months rows ({ month, extra_days }) as { 11: 7, ... }.
export function busyMonthsFrom(rows = []) {
  return Object.fromEntries(
    rows.filter((row) => Number(row.extra_days) > 0).map((row) => [Number(row.month), Number(row.extra_days)])
  )
}


// The customer's country from prediction_countries rows, else the Default row.
export function countryFrom(rows = [], country) {
  const row = rows.find((entry) => countryKey(entry.country) === countryKey(country))
    || rows.find((entry) => countryKey(entry.country) === 'default')

  if (!row) return {}

  return {
    sailingDays: row.sailing_days === null || row.sailing_days === undefined ? null : Number(row.sailing_days),
    extraLabelingDays: Number(row.extra_labeling_days) || 0,
    isPlaceholder: Boolean(row.is_placeholder),
  }
}


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


// One order's suppliers: those of its products, and of its purchase orders.
//   items          [{ products: { supplier_id } }]
//   purchaseOrders [{ id, expected_delivery_date }]  this order's POs
//   poLines        [{ purchase_order_id, supplier_id, fully_received_at }]
//   starting       { supplier_id: prediction_suppliers row }
//   names          { supplier_id: name }
export function orderSuppliers({ items = [], purchaseOrders = [], poLines = [], histories = {}, starting = {}, names = {} }) {
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
    const row = starting[supplierId]

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
      starting: row
        ? { usualLeadDays: row.usual_lead_days, lateFrequency: row.late_frequency, usualLateDays: row.usual_late_days }
        : null,
    }
  })
}


// Cases ordered, for labeling time per 1,000 cases. Order lines are in cases.
export const casesIn = (items = []) => items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)


// Everything predictOrder's context needs for one order. Missing pieces just
// leave that part to the defaults.
export function estimateContext({ order, items, purchaseOrders, poLines, histories, startingSuppliers, supplierNames, settings, countries, busyMonths, country, now, models = null }) {
  const shipped = normalizeStatus(order?.status) === 'shipped'

  return {
    now,
    startingDays: startingDaysFrom(settings),
    busyMonths: busyMonthsFrom(busyMonths),
    country: countryFrom(countries, country),
    cases: casesIn(items),
    products: (items || []).length,
    countryName: country || '',
    models,
    suppliers: shipped ? [] : orderSuppliers({
      items,
      purchaseOrders,
      poLines,
      histories,
      starting: startingSuppliers,
      names: supplierNames,
    }),
  }
}
