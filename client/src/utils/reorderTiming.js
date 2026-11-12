// =============================================================================
// Reorder timing — when each customer will likely order next
//
// Learned only from the system's own orders: the days between each customer's
// orders. A customer's next order is expected its usual gap after its last
// one, with a likely range. Its usual gap comes from its own last RECENT_GAPS
// gaps: only the latest, since a customer's pace changes over the year. A
// customer with too few gaps yet leans on every customer's: its n gaps count
// for n ÷ (n + 5) (utils/predictions.js blendStep), the same rule a supplier
// with few deliveries follows.
//
// Orders placed on the same day count as one. Cancelled orders don't count.
// services/analyticsService.js loads the rows.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { MIN_RECORDS, blendStep, normalizeStatus } from './predictions.js'
import { manilaDate } from './supplierScores.js'

const DAY = 24 * 60 * 60 * 1000

export const RECENT_GAPS = 4            // a customer's pace: its last 4 gaps between orders
export const REORDER_SOON_DAYS = 14     // "soon": expected within 2 weeks
export const QUIET_DAYS = 365           // a customer with no order in a year is left out
export const REORDER_TEST_SHARE = 0.2   // the check: the newest 20% of gaps
export const MIN_TESTED_GAPS = 5        // gaps the check needs

const daysBetween = (fromDay, toDay) => Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY)
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + Math.round(days) * DAY).toISOString().slice(0, 10)
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}


// Each customer's ordering days (in the Philippines), oldest first, with that
// day's orders: { customer_id: [{ day, orders }] }.
export function orderingDays(orders = []) {
  const byCustomer = new Map()

  for (const order of orders) {
    if (!order.customer_id || !order.created_at) continue
    if (normalizeStatus(order.status) === 'cancelled') continue

    const day = manilaDate(order.created_at)
    if (!byCustomer.has(order.customer_id)) byCustomer.set(order.customer_id, new Map())
    const days = byCustomer.get(order.customer_id)
    if (!days.has(day)) days.set(day, [])
    days.get(day).push(order)
  }

  return new Map([...byCustomer].map(([customerId, days]) => [
    customerId,
    [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, dayOrders]) => ({ day, orders: dayOrders })),
  ]))
}


// The gaps between each customer's ordering days, oldest first:
// { customer_id: [{ from, to, days }] }.
export function orderGaps(daysByCustomer) {
  return new Map([...daysByCustomer].map(([customerId, days]) => [
    customerId,
    days.slice(1).map((entry, index) => ({ from: days[index].day, to: entry.day, days: daysBetween(days[index].day, entry.day) })),
  ]))
}


// A customer's usual gap as things stood on a day, from its last RECENT_GAPS
// gaps finished by then: the middle one, with the shortest and longest as its
// likely range. With fewer than MIN_RECORDS gaps of its own it leans on every
// customer's (their last RECENT_GAPS each): its n gaps count for n ÷ (n + 5).
// Null without MIN_RECORDS gaps to go by.
export function paceOf(gapsByCustomer, customerId, asOfDay) {
  const recent = (gaps) => gaps.filter((gap) => gap.to <= asOfDay).slice(-RECENT_GAPS).map((gap) => gap.days)
  const own = recent(gapsByCustomer.get(customerId) || [])
  const everyone = [...gapsByCustomer.values()].flatMap(recent)

  const span = own.length >= MIN_RECORDS
    ? { typical: median(own), quick: Math.min(...own), slow: Math.max(...own) }
    : blendStep(own, everyone)

  return span ? { typical: span.typical, quick: span.quick, slow: span.slow, own: own.length, everyone } : null
}


// How close the expected gap came on the newest gaps, each predicted as things
// stood on the day the order before it was placed, against giving every
// customer the same gap (every customer's usual one). Null with too few gaps.
export function checkReorders(gapsByCustomer) {
  const all = [...gapsByCustomer].flatMap(([customerId, gaps]) => gaps.map((gap) => ({ ...gap, customerId })))
    .sort((a, b) => a.to.localeCompare(b.to))
  const testCount = Math.round(all.length * REORDER_TEST_SHARE)
  if (testCount < MIN_TESTED_GAPS) return null

  const tests = []
  for (const gap of all.slice(-testCount)) {
    const pace = paceOf(gapsByCustomer, gap.customerId, gap.from)
    if (!pace || !pace.everyone.length) continue

    tests.push({
      ownOff: Math.abs(gap.days - pace.typical),
      sameOff: Math.abs(gap.days - median(pace.everyone)),
      inRange: gap.days >= Math.floor(pace.quick) && gap.days <= Math.ceil(pace.slow),
    })
  }
  if (tests.length < MIN_TESTED_GAPS) return null

  return {
    tested: tests.length,
    averageDaysOff: average(tests.map((test) => test.ownOff)),
    sameForAllDaysOff: average(tests.map((test) => test.sameOff)),
    withinRangeShare: tests.filter((test) => test.inRange).length / tests.length,
  }
}


// Each customer's next order: when it's expected, its likely range, and where
// that stands today.
//   orders:    [{ id, customer_id, status, created_at, order_number }]
//   customers: { customer_id: { name, company } }
//   items:     [{ customer_order_id, quantity }]  for each customer's usual order size
// state: 'overdue' (past its likely range), 'due' (inside it), 'soon' (expected
// within REORDER_SOON_DAYS), 'later'. Soonest expected first.
export function reorderTiming({ orders = [], customers = {}, items = null, now = Date.now() }) {
  const today = manilaDate(now)
  const quietSince = addDays(today, -QUIET_DAYS)
  const daysByCustomer = orderingDays(orders)
  const gapsByCustomer = orderGaps(daysByCustomer)
  const gapCount = [...gapsByCustomer.values()].reduce((sum, gaps) => sum + gaps.length, 0)

  const casesByOrder = new Map()
  for (const item of items || []) {
    casesByOrder.set(item.customer_order_id, (casesByOrder.get(item.customer_order_id) || 0) + (Number(item.quantity) || 0))
  }

  const rows = []
  let quiet = 0

  for (const [customerId, days] of daysByCustomer) {
    const last = days.at(-1)
    if (last.day < quietSince) {
      quiet++
      continue
    }

    const pace = paceOf(gapsByCustomer, customerId, today)
    if (!pace) continue

    const expectedDay = addDays(last.day, pace.typical)
    const quickDay = addDays(last.day, pace.quick)
    const slowDay = addDays(last.day, pace.slow)
    const recentCases = items
      ? days.slice(-RECENT_GAPS).map((entry) => entry.orders.reduce((sum, order) => sum + (casesByOrder.get(order.id) || 0), 0)).filter((cases) => cases > 0)
      : []

    rows.push({
      id: customerId,
      name: customers[customerId]?.company || customers[customerId]?.name || 'A customer',
      orders: days.length,
      gaps: pace.own,
      // Few gaps of its own yet: mostly every customer's pace.
      leansOnEveryone: pace.own < MIN_RECORDS,
      usual: pace.typical,
      quick: pace.quick,
      slow: pace.slow,
      lastDay: last.day,
      lastOrderNumber: last.orders.at(-1)?.order_number || null,
      expectedDay,
      range: { quick: quickDay, slow: slowDay },
      state: today > slowDay ? 'overdue' : today >= quickDay ? 'due' : daysBetween(today, expectedDay) <= REORDER_SOON_DAYS ? 'soon' : 'later',
      daysUntil: daysBetween(today, expectedDay),
      overdueDays: today > slowDay ? daysBetween(slowDay, today) : 0,
      usualCases: recentCases.length ? median(recentCases) : null,
    })
  }

  rows.sort((a, b) => a.expectedDay.localeCompare(b.expectedDay) || a.name.localeCompare(b.name))

  const everyone = paceOf(gapsByCustomer, null, today)

  return {
    enough: Boolean(everyone),
    gaps: gapCount,
    needed: MIN_RECORDS,
    customers: rows,
    quiet,
    everyone: everyone ? { usual: everyone.typical, quick: everyone.quick, slow: everyone.slow } : null,
    check: checkReorders(gapsByCustomer),
  }
}
