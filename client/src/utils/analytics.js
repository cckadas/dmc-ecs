// =============================================================================
// Predictive analytics — the numbers behind the charts
//
// Worked out only from the system's own records (status history, purchase
// orders, deliveries), with the same rules as the estimates (utils/predictions.js)
// and supplier scores (utils/supplierScores.js), so the charts agree with every
// other screen. services/analyticsService.js loads the rows;
// pages/PredictiveAnalytics.jsx draws them.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { ESTIMATE_STEPS, MIN_RECORDS, blendStep, buildStageStatistics, monthEffects, normalizeStatus, predictOrder, recordShare } from './predictions.js'
import { estimateContext, supplierHistories, supplierPool } from './estimateInputs.js'
import { SCORE_WINDOW_DAYS, manilaDate, scoreSuppliers } from './supplierScores.js'

const DAY = 24 * 60 * 60 * 1000

export const ON_TIME_TARGET = 0.85      // a supplier's on-time rate to aim for: the Reliable band's 85
export const WITHIN_DAYS = 3            // an estimate within 3 days of the real ship date counts as close
export const MIN_ACCURACY_ORDERS = 10   // finished orders needed before accuracy is reported
export const TEST_SHARE = 0.2           // accuracy is tested on the newest 20% of finished orders
export const WEEKS_AHEAD = 8            // "coming up" covers this week and the next 7

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
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
const byTime = (a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at)
const timeOf = (value) => new Date(value).getTime()
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY)
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

const sortedHistory = (historyByOrder, orderId) => [...(historyByOrder[orderId] || [])].sort(byTime)
const firstInto = (entries, status) => entries.find((entry) => normalizeStatus(entry.new_status) === status) || null
const lastInto = (entries, status) => [...entries].reverse().find((entry) => normalizeStatus(entry.new_status) === status) || null
const isShipped = (order) => normalizeStatus(order.status) === 'shipped'


// The Monday of the week a moment falls in, in the Philippines, as YYYY-MM-DD.
export function weekOf(value) {
  const day = manilaDate(value)
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(day, -weekday)
}


// 1. Where the time goes ---------------------------------------------------------
// Each step's usual days, with its quick and slow cases, from finished orders:
// the same numbers the estimates use. A step with fewer than MIN_RECORDS
// finished orders has no numbers yet. The down payment isn't a step here: it
// waits on the customer.
export function stepTimes(stageStatistics) {
  return ESTIMATE_STEPS.map((step) => {
    const durations = stageStatistics?.[step.key]?.durations || []
    const span = blendStep(durations)
    return {
      key: step.key,
      label: step.label,
      typical: span?.typical ?? null,
      quick: span?.quick ?? null,
      slow: span?.slow ?? null,
      records: durations.length,
      needed: MIN_RECORDS,
    }
  })
}


// 2. On-time rate by supplier -----------------------------------------------------
// Deliveries by the promised date over the last 12 months, worst first, for the
// suppliers with enough deliveries for a score. The others are listed apart.
export function supplierOnTime(deliveries, suppliers, { today = new Date() } = {}) {
  const scores = scoreSuppliers(deliveries, suppliers.map((supplier) => supplier.id), { today: new Date(today) })
  const rows = suppliers.map((supplier) => ({ supplier, score: scores[supplier.id] }))
  const rated = ({ score }) => score.enough && score.onTimeRate !== null

  return {
    rated: rows
      .filter(rated)
      .map(({ supplier, score }) => ({
        id: supplier.id,
        name: supplier.supplier_name,
        onTimeRate: score.onTimeRate,
        onTimeCount: score.onTimeCount,
        judged: score.onTimeCount + score.lateCount,
        belowTarget: score.onTimeRate < ON_TIME_TARGET,
      }))
      .sort((a, b) => a.onTimeRate - b.onTimeRate || a.name.localeCompare(b.name)),
    tooFew: rows
      .filter((row) => row.score.count > 0 && !rated(row))
      .map(({ supplier, score }) => ({ id: supplier.id, name: supplier.supplier_name, deliveries: score.count })),
  }
}


// 3. Lead time by supplier ---------------------------------------------------------
// Days from PO to delivery as the estimates use them: the supplier's own
// deliveries, leaning on every supplier's while it has few. The line runs from
// the quick case to the slow case; a long one is an unpredictable supplier.
// Suppliers with no deliveries yet are only counted: they'd go by every
// supplier's (allDays). Slowest first.
export function supplierLeadTimes(deliveries, suppliers, { today = new Date() } = {}) {
  const histories = supplierHistories(deliveries, new Date(today))
  const everyone = supplierPool(deliveries, new Date(today)).leadDays
  const rows = []
  let noDeliveries = 0

  for (const supplier of suppliers) {
    const leads = histories[supplier.id]?.leadDays || []
    const span = leads.length ? blendStep(leads, everyone) : null

    if (!span) {
      noDeliveries++
      continue
    }

    rows.push({
      id: supplier.id,
      name: supplier.supplier_name,
      usual: span.typical,
      quick: span.quick,
      slow: span.slow,
      deliveries: leads.length,
      // Few deliveries of its own: it leans on every supplier's.
      leansOnEveryone: span.share < 0.5,
    })
  }

  rows.sort((a, b) => b.usual - a.usual || a.name.localeCompare(b.name))

  return { rows, noDeliveries, allDays: blendStep(everyone)?.typical ?? null, allDeliveries: everyone.length }
}


// 3b. Busy months, found in the deliveries ------------------------------------------
// For POs sent in each month, how many days longer (or shorter) their deliveries
// took than usual: each month's middle value against all months', counting for
// n ÷ (n + 5) of the difference so a month with few deliveries barely moves. The
// estimates add these days to a supplier not ordered from yet. Twelve months,
// January first; a month with no deliveries has none.
export function busyMonths(deliveries, { today = new Date() } = {}) {
  const { leadByMonth } = supplierPool(deliveries, new Date(today))
  const effects = monthEffects(leadByMonth)

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const count = leadByMonth.filter((record) => record.month === month).length
    return { month, deliveries: count, extraDays: count ? effects[month] ?? 0 : null, share: recordShare(count) }
  })
}


// 4. Shipping on time, by month -----------------------------------------------------
// Of the orders shipped each month that had a requested ship date, the share
// shipped by that date (calendar days in the Philippines). From the first month
// with one, up to this month, at most 12 months.
export function shippingOnTimeByMonth(orders, historyByOrder, { today = new Date(), months = 12 } = {}) {
  const counts = new Map()

  for (const order of orders) {
    if (!isShipped(order) || !order.requested_ship_date) continue

    const shipped = lastInto(sortedHistory(historyByOrder, order.id), 'shipped')
    if (!shipped) continue

    const shipDay = manilaDate(shipped.changed_at)
    const month = shipDay.slice(0, 7)
    const entry = counts.get(month) || { shipped: 0, onTime: 0 }
    entry.shipped++
    if (shipDay <= String(order.requested_ship_date).slice(0, 10)) entry.onTime++
    counts.set(month, entry)
  }

  const [year, month] = manilaDate(today).slice(0, 7).split('-').map(Number)
  const window = Array.from({ length: months }, (_, index) =>
    new Date(Date.UTC(year, month - months + index, 1)).toISOString().slice(0, 7))
  const first = window.findIndex((key) => counts.has(key))

  if (first < 0) return []

  return window.slice(first).map((key) => {
    const entry = counts.get(key)
    return { month: key, shipped: entry?.shipped || 0, onTime: entry?.onTime || 0, rate: entry ? entry.onTime / entry.shipped : null }
  })
}


// 5. Coming up, by week -------------------------------------------------------------
// The orders under way by the week they should be ready to ship (their estimated
// ready date), this week and the next 7. Orders already ready count in this
// week. Orders waiting for the down payment haven't started, so they're left out.
export function comingUpByWeek(predictions, { now = Date.now(), weeks = WEEKS_AHEAD } = {}) {
  const thisWeek = weekOf(now)
  const buckets = Array.from({ length: weeks }, (_, index) => ({ weekStart: addDays(thisWeek, index * 7), count: 0, orders: [] }))
  let later = 0

  for (const prediction of predictions) {
    if (prediction.shipped || prediction.ifPaidToday || !prediction.estimatedReadyDate) continue

    const index = Math.max(0, Math.round(daysBetween(thisWeek, weekOf(prediction.estimatedReadyDate)) / 7))
    if (index >= weeks) {
      later++
      continue
    }

    buckets[index].count++
    buckets[index].orders.push(prediction.order_number || 'An order')
  }

  return { weeks: buckets, later }
}


// 6. Prediction accuracy -------------------------------------------------------------
// Finished orders: shipped, at least a day after their payment was verified
// (quicker ones are test runs, as in the estimates). Oldest first.
export function finishedForAccuracy(orders, historyByOrder) {
  return orders
    .map((order) => {
      if (!isShipped(order)) return null

      const entries = sortedHistory(historyByOrder, order.id)
      const verified = firstInto(entries, 'payment verified')
      const shipped = lastInto(entries, 'shipped')
      if (!verified || !shipped) return null

      const verifiedAt = Date.parse(verified.changed_at)
      const shippedAt = Date.parse(shipped.changed_at)
      if ((shippedAt - verifiedAt) / DAY < 1) return null

      return { order, verifiedAt, shippedAt }
    })
    .filter(Boolean)
    .sort((a, b) => a.verifiedAt - b.verifiedAt)
}


// Finished orders the method didn't learn from are predicted as of the day each
// one's payment was verified, and compared with the day it really shipped:
//   - split by time: learn from the older 80% of finished orders, test the newest 20%
//   - methods: the same for every order (the usual days from payment to
//     shipping of the orders learned from, the baseline to beat), the
//     statistics step by step, and, once it's trained, the statistics with the
//     model (the saved one, which learned only from orders before these)
//   - reported: the share that shipped within the likely range shown (the quick
//     to slow case; the baseline's is past orders' quick and slow quarters), the
//     share within 3 days of the single date, and the average days off
// items: [{ customer_order_id, quantity, products: { supplier_id } }] of the
// finished orders; locations: [{ id, country }]; deliveries: buildDeliveries';
// names: { supplier_id: name }; models: the saved models (estimateLoader's
// loadModels with inUseOnly false); kinds: each order's labeling kind
// (utils/labelingKind.js), as a Map
export function accuracyCheck({ orders = [], history = [], items = [], locations = [], deliveries = [], names = {}, models = null, kinds = null }) {
  const { historyByOrder } = buildStageStatistics(history)
  const finished = finishedForAccuracy(orders, historyByOrder)

  if (finished.length < MIN_ACCURACY_ORDERS) {
    return { enough: false, finished: finished.length, needed: MIN_ACCURACY_ORDERS }
  }

  const tested = Math.max(1, Math.round(finished.length * TEST_SHARE))
  const learnFrom = finished.slice(0, finished.length - tested)
  const testOn = finished.slice(finished.length - tested)

  const learnIds = new Set(learnFrom.map(({ order }) => order.id))
  const kindOf = kinds?.size ? (orderId) => kinds.get(orderId) : null
  const learned = buildStageStatistics(history.filter((entry) => learnIds.has(entry.customer_order_id)), kindOf).stageStatistics

  // The baseline: every order gets the usual days from payment to shipping, and
  // the quick and slow quarters of past orders as its range.
  const totals = learnFrom.map(({ verifiedAt, shippedAt }) => (shippedAt - verifiedAt) / DAY)
  const usualDays = median(totals)
  const usualRange = { quick: percentile(totals, 0.25), slow: percentile(totals, 0.75) }

  const daysOff = { average: [], statistics: [], model: [] }
  const inRange = { average: [], statistics: [], model: [] }
  const between = (quickTime, shippedOn, slowTime) => manilaDate(quickTime) <= shippedOn && shippedOn <= manilaDate(slowTime)
  // As the estimates use them: each model only once it beat the statistics. With
  // neither in use yet, the row shows how the saved ones would do.
  const inUse = { supplier: models?.supplier?.inUse ? models.supplier : null, labeling: models?.labeling?.inUse ? models.labeling : null }
  const modelInUse = Boolean(inUse.supplier || inUse.labeling)
  const withModel = modelInUse ? inUse : models && (models.supplier || models.labeling) ? { supplier: models.supplier, labeling: models.labeling } : null

  for (const { order, verifiedAt, shippedAt } of testOn) {
    const asOf = { ...order, status: 'payment verified' }
    const ownHistory = { [order.id]: (historyByOrder[order.id] || []).filter((entry) => Date.parse(entry.changed_at) <= verifiedAt) }
    // What was known about the suppliers then: deliveries received before that day.
    const knownThen = deliveries.filter((delivery) => delivery.receivedOn < manilaDate(verifiedAt))
    const shippedOn = manilaDate(shippedAt)
    const sameForAll = manilaDate(verifiedAt + usualDays * DAY)

    daysOff.average.push(Math.abs(daysBetween(sameForAll, shippedOn)))
    const baselineInRange = between(verifiedAt + usualRange.quick * DAY, shippedOn, verifiedAt + usualRange.slow * DAY)
    inRange.average.push(baselineInRange)

    for (const method of ['statistics', ...(withModel ? ['model'] : [])]) {
      const prediction = predictOrder(asOf, learned, ownHistory, estimateContext({
        order: asOf,
        items: items.filter((item) => item.customer_order_id === order.id),
        purchaseOrders: [],
        poLines: [],
        histories: supplierHistories(knownThen, new Date(verifiedAt)),
        pool: supplierPool(knownThen, new Date(verifiedAt)),
        supplierNames: names,
        country: locations.find((location) => location.id === order.delivery_location_id)?.country,
        now: verifiedAt,
        models: method === 'model' ? withModel : null,
        labelingKind: kinds?.get(order.id) || null,
      }))

      // Too few records then to estimate a step: the baseline's day and range.
      const predictedOn = prediction.estimatedShipDate ? manilaDate(prediction.estimatedShipDate) : sameForAll
      daysOff[method].push(Math.abs(daysBetween(predictedOn, shippedOn)))
      inRange[method].push(prediction.shipDateRange
        ? between(prediction.shipDateRange.quick.getTime(), shippedOn, prediction.shipDateRange.slow.getTime())
        : baselineInRange)
    }
  }

  const summary = (key) => ({
    averageDaysOff: average(daysOff[key]),
    withinShare: daysOff[key].filter((value) => value <= WITHIN_DAYS).length / daysOff[key].length,
    withinRangeShare: inRange[key].filter(Boolean).length / inRange[key].length,
  })

  return {
    enough: true,
    finished: finished.length,
    learnedFrom: learnFrom.length,
    tested: testOn.length,
    usualDays,
    methods: [
      { key: 'average', label: 'Same for every order', ...summary('average') },
      { key: 'statistics', label: 'Statistics', inUse: !modelInUse, ...summary('statistics') },
      ...(withModel ? [{ key: 'model', label: 'Statistics + model', inUse: modelInUse, ...summary('model') }] : []),
    ],
  }
}


// The four numbers ---------------------------------------------------------------------
// At the top of the page and on the Executive Dashboard:
//   orders on track      of the orders under way (payment check onward)
//   payment to shipping  average days from the payment check to shipped, for
//                        orders shipped in the last 12 months
//   supplier on time     deliveries by the promised date, last 12 months
//   accuracy             the share that shipped within the likely range, by the
//                        method in use, once there are enough orders
export function headlineNumbers({ predictions = [], orders = [], historyByOrder = {}, deliveries = [], accuracy = null, today = new Date() }) {
  const underWay = predictions.filter((prediction) => !prediction.shipped && !prediction.ifPaidToday && prediction.estimatedShipDate)
  const since = timeOf(today) - SCORE_WINDOW_DAYS * DAY

  const spans = []
  for (const order of orders) {
    if (!isShipped(order)) continue

    const entries = sortedHistory(historyByOrder, order.id)
    const paid = firstInto(entries, 'submitted') || firstInto(entries, 'payment verified')
    const shipped = lastInto(entries, 'shipped')
    if (!paid || !shipped) continue

    const shippedAt = Date.parse(shipped.changed_at)
    const days = (shippedAt - Date.parse(paid.changed_at)) / DAY
    if (shippedAt >= since && days >= 1) spans.push(days)
  }

  const sinceDay = manilaDate(since)
  const judged = deliveries.filter((delivery) => delivery.receivedOn >= sinceDay && delivery.onTime !== null)
  const statistics = accuracy?.enough ? accuracy.methods.find((method) => method.inUse) : null

  return {
    onTrack: { count: underWay.filter((prediction) => prediction.risk !== 'at risk').length, total: underWay.length },
    paymentToShip: { days: average(spans), orders: spans.length },
    supplierOnTime: { rate: judged.length ? judged.filter((delivery) => delivery.onTime).length / judged.length : null, deliveries: judged.length },
    accuracy: statistics
      ? { withinRangeShare: statistics.withinRangeShare, withinShare: statistics.withinShare, averageDaysOff: statistics.averageDaysOff, tested: accuracy.tested }
      : { withinShare: null, finished: accuracy?.finished ?? 0, needed: MIN_ACCURACY_ORDERS },
  }
}


// 7. A supplier's delivery history ---------------------------------------------------
// Its deliveries of the last 12 months in date order, each with how many days
// after the promised date it arrived (below zero when early). Deliveries without
// a promised date can't be judged, so they're left out. The latest 30.
export function deliveryHistory(deliveries, { today = new Date(), limit = 30 } = {}) {
  const since = manilaDate(timeOf(today) - SCORE_WINDOW_DAYS * DAY)

  return deliveries
    .filter((delivery) => delivery.receivedOn >= since && delivery.lateness !== null)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || String(a.poNumber).localeCompare(String(b.poNumber)))
    .slice(-limit)
    .map(({ purchaseOrderId, poNumber, receivedOn, promised, lateness }) => ({ purchaseOrderId, poNumber, receivedOn, promised, lateness }))
}
