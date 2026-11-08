// =============================================================================
// Supplier scores — the maths only
//
// Worked out from actual deliveries, never typed in. A delivery is one
// supplier's part of one purchase order, done when its last line is fully
// received (purchase_order_items.fully_received_at, recorded since
// db/migrations/012), and it's compared with the date the PO promised.
//
//   on-time rate       = deliveries received by the promised date ÷ deliveries
//   reliability score  = on-time rate (%) − 2 points per average day late
//
// Only the last 12 months count, and a supplier needs 3 deliveries for a score.
// No imports on purpose, like utils/predictions.js, so every page that shows a
// score gives the same one.
// =============================================================================

const DAY = 1000 * 60 * 60 * 24

export const MIN_DELIVERIES = 3
export const LATE_POINTS_PER_DAY = 2
export const SCORE_WINDOW_DAYS = 365

export const SCORE_BANDS = [
  { min: 85, label: 'Reliable', tone: 'good' },
  { min: 70, label: 'Watch', tone: 'warning' },
  { min: 0, label: 'Unreliable', tone: 'bad' },
]

export const scoreBand = (score) => SCORE_BANDS.find((band) => score >= band.min)

// A moment's date in the Philippines (UTC+8, no daylight saving), as YYYY-MM-DD.
export const manilaDate = (value) =>
  new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

const daysBetween = (fromDate, toDate) => Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY)

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const percentile = (values, fraction) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}


// Purchase order lines, each with its purchase order nested as purchase_orders,
// into finished deliveries, newest first. A supplier's part of a PO with any
// line not yet fully received isn't finished, so it isn't counted.
export function buildDeliveries(lines) {
  const byDelivery = new Map()

  for (const line of lines) {
    const order = line.purchase_orders
    if (!order?.id || !line.supplier_id) continue

    const key = `${order.id}:${line.supplier_id}`
    if (!byDelivery.has(key)) byDelivery.set(key, { supplierId: line.supplier_id, order, receivedAt: [] })
    byDelivery.get(key).receivedAt.push(line.fully_received_at || null)
  }

  const deliveries = []

  for (const { supplierId, order, receivedAt } of byDelivery.values()) {
    if (receivedAt.includes(null) || !order.created_at) continue

    const orderedOn = manilaDate(order.created_at)
    const receivedOn = manilaDate(Math.max(...receivedAt.map((value) => Date.parse(value))))
    const promised = order.expected_delivery_date || null

    deliveries.push({
      supplierId,
      purchaseOrderId: order.id,
      poNumber: order.po_number || null,
      orderedOn,
      promised,
      receivedOn,
      leadDays: daysBetween(orderedOn, receivedOn),
      // A delivery with no promised date can't be judged on time or late.
      onTime: promised ? receivedOn <= promised : null,
      daysLate: promised ? Math.max(0, daysBetween(promised, receivedOn)) : null,
      // Days after the promised date it arrived; below 0 when early. For estimates.
      lateness: promised ? daysBetween(promised, receivedOn) : null,
    })
  }

  return deliveries.sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
}


// One supplier's score from its deliveries (from buildDeliveries).
export function scoreSupplier(deliveries, { today = new Date() } = {}) {
  const since = manilaDate(today.getTime() - SCORE_WINDOW_DAYS * DAY)
  const recent = deliveries.filter((delivery) => delivery.receivedOn >= since)
  const judged = recent.filter((delivery) => delivery.onTime !== null)
  const late = judged.filter((delivery) => !delivery.onTime)

  const onTimeRate = judged.length ? (judged.length - late.length) / judged.length : null
  const averageDaysLate = late.length ? late.reduce((sum, delivery) => sum + delivery.daysLate, 0) / late.length : 0
  const leads = recent.map((delivery) => delivery.leadDays).filter((days) => days >= 0)

  const enough = recent.length >= MIN_DELIVERIES
  const score = enough && onTimeRate !== null
    ? Math.max(0, Math.min(100, Math.round(onTimeRate * 100 - LATE_POINTS_PER_DAY * averageDaysLate)))
    : null

  return {
    deliveries: recent,
    count: recent.length,
    onTimeCount: judged.length - late.length,
    lateCount: late.length,
    onTimeRate,
    averageDaysLate,
    usualLeadDays: median(leads),
    leadLow: percentile(leads, 0.25),
    leadHigh: percentile(leads, 0.75),
    enough,
    score,
    band: score === null ? null : scoreBand(score),
  }
}


// Scores for every supplier, by supplier id. A supplier with no deliveries
// still gets an entry, with a count of 0.
export function scoreSuppliers(deliveries, supplierIds = [], options) {
  const bySupplier = new Map(supplierIds.map((id) => [id, []]))

  for (const delivery of deliveries) {
    if (!bySupplier.has(delivery.supplierId)) bySupplier.set(delivery.supplierId, [])
    bySupplier.get(delivery.supplierId).push(delivery)
  }

  return Object.fromEntries(
    [...bySupplier.entries()].map(([id, list]) => [id, scoreSupplier(list, options)])
  )
}
