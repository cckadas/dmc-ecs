// =============================================================================
// Predictive analytics — the numbers behind the charts
//
// Worked out from the system's own records (status history, purchase orders,
// deliveries), blended with DMC staff's starting values, with the same rules as
// the estimates (utils/predictions.js) and supplier scores (utils/supplierScores.js),
// so the charts agree with every other screen. services/analyticsService.js
// loads the rows; pages/PredictiveAnalytics.jsx draws them.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { ESTIMATE_STEPS, blendStep, buildStageStatistics, normalizeStatus, predictOrder } from './predictions.js'
import { estimateContext, supplierHistories } from './estimateInputs.js'
import { SCORE_WINDOW_DAYS, manilaDate, scoreSuppliers } from './supplierScores.js'

const DAY = 24 * 60 * 60 * 1000

export const ON_TIME_TARGET = 0.85      // a supplier's on-time rate to aim for: the Reliable band's 85
export const WITHIN_DAYS = 3            // an estimate within 3 days of the real ship date counts as close
export const MIN_ACCURACY_ORDERS = 10   // finished orders needed before accuracy is reported
export const TEST_SHARE = 0.2           // accuracy is tested on the newest 20% of finished orders
export const WEEKS_AHEAD = 8            // "coming up" covers this week and the next 7

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
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
// Each step's usual days, with its quick and slow cases: finished orders blended
// with DMC's starting values, the same numbers the estimates use. The down
// payment isn't a step here: it waits on the customer.
export function stepTimes(stageStatistics, startingDays) {
  const startingFor = {
    payment_check: startingDays.payment_check,
    ordering: startingDays.ordering,
    suppliers: startingDays.supplier_lead,
    labeling: startingDays.labeling,
    shipping: startingDays.shipping,
  }

  return ESTIMATE_STEPS.map((step) => {
    const span = blendStep(stageStatistics?.[step.key]?.durations || [], startingFor[step.key])
    return { key: step.key, label: step.label, typical: span.typical, quick: span.quick, slow: span.slow, records: span.count }
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
// Days from PO to delivery as the estimates use them: the supplier's deliveries
// blended with DMC's number. The line runs from the quick case to the slow case;
// a long one is an unpredictable supplier. Suppliers with neither deliveries nor
// a DMC number use the default, and are only counted. Slowest first.
export function supplierLeadTimes(deliveries, suppliers, startingSuppliers = {}, startingDays, { today = new Date() } = {}) {
  const histories = supplierHistories(deliveries, new Date(today))
  const rows = []
  let onDefault = 0

  for (const supplier of suppliers) {
    const leads = histories[supplier.id]?.leadDays || []
    const theirs = startingSuppliers[supplier.id]
    const dmcDays = Number(theirs?.usual_lead_days) || null

    if (!leads.length && !dmcDays) {
      onDefault++
      continue
    }

    const startingLead = dmcDays || startingDays.supplier_lead
    const span = blendStep(leads, startingLead)

    rows.push({
      id: supplier.id,
      name: supplier.supplier_name,
      usual: span.typical,
      quick: span.quick,
      // As in the estimates: while there are no deliveries, DMC's "usually late
      // by" widens the slow case.
      slow: leads.length ? span.slow : Math.max(span.slow, startingLead + (Number(theirs?.usual_late_days) || 0)),
      deliveries: leads.length,
      fromDmc: Boolean(dmcDays),
    })
  }

  rows.sort((a, b) => b.usual - a.usual || a.name.localeCompare(b.name))

  return { rows, onDefault, defaultDays: startingDays.supplier_lead }
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
//   - methods: starting values only (DMC's numbers with no records, the baseline
//     to beat) and statistics (the estimates as they work today)
//   - reported: the average days off, and the share within 3 days
// items: [{ customer_order_id, quantity, products: { supplier_id } }] of the
// finished orders; locations: [{ id, country }]; deliveries: buildDeliveries';
// starting: loadStartingValues'; names: { supplier_id: name }
export function accuracyCheck({ orders = [], history = [], items = [], locations = [], deliveries = [], starting = {}, names = {} }) {
  const { historyByOrder } = buildStageStatistics(history)
  const finished = finishedForAccuracy(orders, historyByOrder)

  if (finished.length < MIN_ACCURACY_ORDERS) {
    return { enough: false, finished: finished.length, needed: MIN_ACCURACY_ORDERS }
  }

  const tested = Math.max(1, Math.round(finished.length * TEST_SHARE))
  const learnFrom = finished.slice(0, finished.length - tested)
  const testOn = finished.slice(finished.length - tested)

  const learnIds = new Set(learnFrom.map(({ order }) => order.id))
  const learned = buildStageStatistics(history.filter((entry) => learnIds.has(entry.customer_order_id))).stageStatistics
  const nothing = buildStageStatistics([]).stageStatistics

  const daysOff = { starting: [], statistics: [] }

  for (const { order, verifiedAt, shippedAt } of testOn) {
    const asOf = { ...order, status: 'payment verified' }
    const ownHistory = { [order.id]: (historyByOrder[order.id] || []).filter((entry) => Date.parse(entry.changed_at) <= verifiedAt) }
    // What was known about the suppliers then: deliveries received before that day.
    const knownThen = deliveries.filter((delivery) => delivery.receivedOn < manilaDate(verifiedAt))
    const shippedOn = manilaDate(shippedAt)

    for (const method of ['starting', 'statistics']) {
      const withRecords = method === 'statistics'

      const prediction = predictOrder(asOf, withRecords ? learned : nothing, ownHistory, estimateContext({
        order: asOf,
        items: items.filter((item) => item.customer_order_id === order.id),
        purchaseOrders: [],
        poLines: [],
        histories: withRecords ? supplierHistories(knownThen, new Date(verifiedAt)) : {},
        startingSuppliers: starting.startingSuppliers || {},
        supplierNames: names,
        settings: starting.settings,
        countries: starting.countries,
        busyMonths: starting.busyMonths,
        country: locations.find((location) => location.id === order.delivery_location_id)?.country,
        now: verifiedAt,
      }))

      daysOff[method].push(Math.abs(daysBetween(manilaDate(prediction.estimatedShipDate), shippedOn)))
    }
  }

  const summary = (days) => ({
    averageDaysOff: average(days),
    withinShare: days.filter((value) => value <= WITHIN_DAYS).length / days.length,
  })

  return {
    enough: true,
    finished: finished.length,
    learnedFrom: learnFrom.length,
    tested: testOn.length,
    methods: [
      { key: 'starting', label: 'Starting values only', ...summary(daysOff.starting) },
      { key: 'statistics', label: 'Statistics', inUse: true, ...summary(daysOff.statistics) },
    ],
  }
}


// The four numbers ---------------------------------------------------------------------
// At the top of the page and on the Executive Dashboard:
//   orders on track      of the orders under way (payment check onward)
//   payment to shipping  average days from the payment check to shipped, for
//                        orders shipped in the last 12 months
//   supplier on time     deliveries by the promised date, last 12 months
//   accuracy             the statistics' share within 3 days, once there are enough orders
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
  const statistics = accuracy?.enough ? accuracy.methods.find((method) => method.key === 'statistics') : null

  return {
    onTrack: { count: underWay.filter((prediction) => prediction.risk !== 'at risk').length, total: underWay.length },
    paymentToShip: { days: average(spans), orders: spans.length },
    supplierOnTime: { rate: judged.length ? judged.filter((delivery) => delivery.onTime).length / judged.length : null, deliveries: judged.length },
    accuracy: statistics
      ? { withinShare: statistics.withinShare, averageDaysOff: statistics.averageDaysOff, tested: accuracy.tested }
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
