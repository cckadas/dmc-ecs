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


// How often each product is ordered -----------------------------------------------------
// The days between the days a product is in an order (anyone's) over the last
// 12 months: the middle one, and the middle half of them. And who orders it:
// each customer that ordered it in those months, in how many of its orders.
// It's a description: a product's next order can't be told from its own gaps,
// since several customers order it, each at its own pace (on the made-up
// history no way of reading its gaps came closer than the same gap for every
// product). Each customer's next order can (reorderTiming, below), so who's
// likely to order it next comes from its customers.
// Cancelled orders don't count; an order counts from the day it's placed, so
// one placed today shows at once.
//   orders: [{ id, customer_id, status, created_at, order_number }]
//   items:  [{ customer_order_id, product_id, quantity }]
// Returns { products: Map of product id → timing }, timing being
//   orders, customers, cases   in the last 12 months
//   ordersAll, lastDay         in all, and the day it was last ordered
//   usual, quick, slow         the middle gap between the days it was ordered
//                              in the last 12 months, and the middle half of
//                              them; null with fewer than MIN_RECORDS gaps
//   gaps                       its gaps in the last 12 months
//   buyers                     [{ customerId, orders, ofOrders, lastDay }]: each
//                              customer's orders with it in 12 months, out of
//                              all its orders then, most first
//   thisMonth                  { orders, cases } placed this month
//   list                       its orders, newest first:
//                              [{ orderId, orderNumber, day, customerId, cases, status }]
export function productTiming({ orders = [], items = [], now = Date.now() }) {
  const today = manilaDate(now)
  const yearAgo = addDays(today, -QUIET_DAYS)
  const thisMonth = today.slice(0, 7)
  const orderById = new Map(orders.map((order) => [order.id, order]))
  const live = (order) => order?.created_at && normalizeStatus(order.status) !== 'cancelled'

  // Each customer's orders in the last 12 months, to say in how many of them a product was.
  const ordersOfCustomer = new Map()
  for (const order of orders) {
    if (!live(order) || !order.customer_id || manilaDate(order.created_at) < yearAgo) continue
    ordersOfCustomer.set(order.customer_id, (ordersOfCustomer.get(order.customer_id) || 0) + 1)
  }

  // Each product's orders, with its cases in each.
  const byProduct = new Map()
  for (const item of items) {
    const order = orderById.get(item.customer_order_id)
    if (!live(order) || !item.product_id) continue
    if (!byProduct.has(item.product_id)) byProduct.set(item.product_id, new Map())
    const theirs = byProduct.get(item.product_id)
    const entry = theirs.get(order.id) || { order, cases: 0 }
    entry.cases += Number(item.quantity) || 0
    theirs.set(order.id, entry)
  }

  // The days between the days each product was ordered: a product's orders as
  // the orders of a customer that is the product, so the same rules apply.
  const asOrders = [...byProduct].flatMap(([productId, theirs]) => [...theirs.values()].map(({ order }) => ({ id: order.id, customer_id: productId, status: order.status, created_at: order.created_at })))
  const gapsByProduct = orderGaps(orderingDays(asOrders))
  const sum = (list) => list.reduce((total, entry) => total + entry.cases, 0)

  const products = new Map()
  for (const [productId, theirs] of byProduct) {
    const list = [...theirs.values()]
      .map(({ order, cases }) => ({ orderId: order.id, orderNumber: order.order_number || null, day: manilaDate(order.created_at), customerId: order.customer_id || null, cases, status: order.status }))
      .sort((a, b) => b.day.localeCompare(a.day) || String(b.orderNumber).localeCompare(String(a.orderNumber)))
    const year = list.filter((entry) => entry.day >= yearAgo)
    const month = list.filter((entry) => entry.day.slice(0, 7) === thisMonth)
    const gaps = (gapsByProduct.get(productId) || []).filter((gap) => gap.to >= yearAgo).map((gap) => gap.days)
    const span = gaps.length >= MIN_RECORDS ? blendStep(gaps) : null

    const buyers = new Map()
    for (const entry of year) {
      if (!entry.customerId) continue
      const buyer = buyers.get(entry.customerId) || { customerId: entry.customerId, orders: 0, ofOrders: ordersOfCustomer.get(entry.customerId) || 0, lastDay: entry.day }
      buyer.orders += 1
      if (entry.day > buyer.lastDay) buyer.lastDay = entry.day
      buyers.set(entry.customerId, buyer)
    }

    products.set(productId, {
      orders: year.length,
      customers: buyers.size,
      cases: sum(year),
      ordersAll: list.length,
      lastDay: list[0].day,
      usual: span?.typical ?? null,
      quick: span?.quick ?? null,
      slow: span?.slow ?? null,
      gaps: gaps.length,
      buyers: [...buyers.values()].sort((a, b) => b.orders - a.orders || b.lastDay.localeCompare(a.lastDay)),
      thisMonth: { orders: month.length, cases: sum(month) },
      list,
    })
  }

  return { products }
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
