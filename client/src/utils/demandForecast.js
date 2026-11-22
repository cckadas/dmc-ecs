// =============================================================================
// Demand forecast — how many cases customers will likely order
//
// Learned only from the system's own orders: the cases ordered each month (an
// order counts once its down payment is sent, by the month it was placed), in
// all and by product category. For the coming months:
//   - the level: the last 6 full months' cases, each taken out of its season
//   - the season: how each calendar month compared with the average month in
//     the year before, counting for n ÷ (n + 1) of the difference (n: the
//     years of that month on record), so one year moves it only halfway; it
//     needs 12 months of records
//   - the forecast: the level times the coming month's season
//   - the likely range: how far past months strayed from level × season
// It's checked like the estimates: the last 6 full months, each forecast from
// the months before it only, against simply repeating the month before. Each
// product's sales and expected cases come with it (productSales).
//
// The month under way is live (liveDemand): its forecast moves toward what has
// actually been placed as the month goes on.
//   - placed so far: the cases in this month's orders past their down payment,
//     and in those still waiting for it (unless one has waited longer than
//     orders almost ever do)
//   - the share gone: how much of a month's cases are usually placed by this
//     far through it, from the months on record (leaning on the plain share
//     of the month's days gone while those months are few)
//   - live = (1 − share gone) × the forecast made from the months before
//          + share gone × (placed so far + that forecast's share for the rest)
//     So a few early or late orders barely move it at the start of a month,
//     and on its last day it is what was ordered. It's never under what is
//     already past its down payment.
//   - its likely range: the forecast's, narrowed the same way, but never
//     narrower than past months ended from their live figure this far through
// It's checked the same way: each of the last 6 full months as it stood this
// far through it, against the forecast made before the month. On the made-up
// history (Nov 2026) the forecast alone was 17.7% off; the live figure was
// within 0.3 of a point of that through the first third of a month, then
// closer: 15% off half way, 12% at three quarters, 7% in the last days.
// Adding the forecast's share for the rest to what's placed, with no blend,
// came closer from mid-month (13% half way) but was further off early on
// (21.5% a tenth of the way in), when a few orders say little: so the blend.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { recordShare } from './predictions.js'

export const LEVEL_MONTHS = 6       // the recent level: the last 6 full months
export const FORECAST_MONTHS = 3    // forecast this many months ahead
export const MIN_MONTHS = 3         // full months of orders needed for a forecast
export const SEASON_MONTHS = 12     // and this many before seasons are used
export const TESTED_MONTHS = 6      // the check: the last 6 full months (busy and quiet ones)
// An order waiting for its down payment still counts as placed while it has
// waited no longer than 19 in 20 orders did (once 3 waits are on record).
export const USUAL_WAIT_SHARE = 0.95
const MIN_WAITS = 3

const DAY = 24 * 60 * 60 * 1000

// Orders that are real demand: past their down payment, not cancelled.
const NOT_DEMAND = new Set(['', 'draft', 'pending payment', 'payment rejected', 'cancelled'])
const normalize = (status) => String(status || '').trim().toLowerCase()
const isDemand = (status) => !NOT_DEMAND.has(normalize(status))

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
const percentile = (values, fraction) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

// The month (YYYY-MM) a moment falls in, in the Philippines.
export const monthOf = (value) => new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7)
export const addMonths = (month, count) => {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 1 + count, 1)).toISOString().slice(0, 7)
}
const calendarMonth = (month) => Number(month.slice(5, 7))


// Cases ordered each full month, from the first month with an order to last
// month: in all ('all') and by category.
//   orders:   { id, status, created_at }
//   items:    { customer_order_id, product_id, quantity }
//   products: { id, category }
export function monthlyDemand({ orders = [], items = [], products = [], today = new Date() }) {
  const placedIn = new Map(orders.filter((order) => isDemand(order.status) && order.created_at).map((order) => [order.id, monthOf(order.created_at)]))
  const categoryOf = Object.fromEntries(products.map((product) => [product.id, String(product.category || '').trim() || 'Other']))
  const thisMonth = monthOf(today)
  const cases = new Map()
  let first = null

  for (const item of items) {
    const month = placedIn.get(item.customer_order_id)
    if (!month || month >= thisMonth) continue

    const quantity = Number(item.quantity) || 0
    for (const key of ['all', categoryOf[item.product_id] || 'Other']) {
      cases.set(`${key}|${month}`, (cases.get(`${key}|${month}`) || 0) + quantity)
    }
    if (!first || month < first) first = month
  }

  if (!first) return { months: [], series: {} }

  const months = []
  for (let month = first; month < thisMonth; month = addMonths(month, 1)) months.push(month)

  const keys = new Set([...cases.keys()].map((key) => key.split('|')[0]))
  const series = Object.fromEntries([...keys].map((key) => [key, months.map((month) => cases.get(`${key}|${month}`) || 0)]))

  return { months, series }
}


// Each calendar month's season (1-12): its cases against the average month,
// counting for n ÷ (n + 1) of the difference. Empty with under 12 months.
export function seasonsOf(months, values) {
  if (months.length < SEASON_MONTHS) return {}
  const average = mean(values)
  if (!average) return {}

  const ratios = {}
  months.forEach((month, index) => (ratios[calendarMonth(month)] ||= []).push(values[index] / average))

  return Object.fromEntries(Object.entries(ratios).map(([month, list]) => [
    month,
    1 + (list.length / (list.length + 1)) * (mean(list) - 1),
  ]))
}


// The next months' cases, from a monthly series: [{ month, cases, quick, slow }].
// Null with fewer than MIN_MONTHS months.
export function forecastSeries(months, values, horizon = FORECAST_MONTHS) {
  if (values.length < MIN_MONTHS) return null

  const seasons = seasonsOf(months, values)
  const seasonOf = (month) => seasons[calendarMonth(month)] || 1
  const recent = months.slice(-LEVEL_MONTHS)
  const level = mean(recent.map((month) => values[months.indexOf(month)] / seasonOf(month)))

  // How far each past month strayed from the usual level times its season.
  const usual = mean(months.map((month, index) => values[index] / seasonOf(month)))
  const strays = months.map((month, index) => (usual > 0 ? values[index] / (usual * seasonOf(month)) : 1))
  const low = Math.min(percentile(strays, 0.25), 1)
  const high = Math.max(percentile(strays, 0.75), 1)

  const last = months[months.length - 1]
  return Array.from({ length: horizon }, (_, index) => {
    const month = addMonths(last, index + 1)
    const cases = level * seasonOf(month)
    return { month, cases, quick: cases * low, slow: cases * high }
  })
}


// The check: each of the last TESTED_MONTHS full months forecast from the months
// before it only, against repeating the month before. Average share off of each.
export function checkForecast(months, values) {
  const tests = []
  for (let index = Math.max(MIN_MONTHS, values.length - TESTED_MONTHS); index < values.length; index++) {
    const [next] = forecastSeries(months.slice(0, index), values.slice(0, index), 1) || []
    if (!next || !(values[index] > 0)) continue
    tests.push({ month: months[index], actual: values[index], forecast: next.cases, lastMonth: values[index - 1], inRange: values[index] >= next.quick && values[index] <= next.slow })
  }

  if (!tests.length) return null
  const off = (predicted, actual) => Math.abs(predicted - actual) / actual

  return {
    tests,
    forecastOff: mean(tests.map((test) => off(test.forecast, test.actual))),
    lastMonthOff: mean(tests.map((test) => off(test.lastMonth, test.actual))),
    inRangeShare: tests.filter((test) => test.inRange).length / tests.length,
  }
}


// Each product's sales, from the system's orders past their down payment:
//   monthly        its cases and amount (US$) in each of the last 12 full months
//   cases, amount  those 12 months' totals
//   trend          the last 3 months' cases against the 3 before (0.2 = 20% more)
//   share          its share of its category's cases over the last 6 months
//   forecast       its expected cases in the coming months: that share times
//                  its category's forecast, so the more it sells, the more
//                  it's expected to sell
// Biggest sellers (by cases) first. forecasts: forecastSeries by category.
export function productSales({ orders = [], items = [], products = [], months = [], forecasts = {} }) {
  const shown = months.slice(-12)
  const recent = new Set(months.slice(-LEVEL_MONTHS))
  const placedIn = new Map(orders.filter((order) => isDemand(order.status) && order.created_at).map((order) => [order.id, monthOf(order.created_at)]))
  const productOf = Object.fromEntries(products.map((product) => [product.id, product]))
  const categoryOf = (product) => String(product.category || '').trim() || 'Other'
  const sales = new Map()
  const categoryRecent = new Map()

  for (const item of items) {
    const month = placedIn.get(item.customer_order_id)
    const product = productOf[item.product_id]
    if (!month || !product || !shown.includes(month)) continue

    const quantity = Number(item.quantity) || 0
    const amount = Number(item.subtotal) || quantity * (Number(item.unit_price) || 0)
    if (!sales.has(product.id)) sales.set(product.id, { cases: {}, amount: {}, recent: 0 })
    const entry = sales.get(product.id)
    entry.cases[month] = (entry.cases[month] || 0) + quantity
    entry.amount[month] = (entry.amount[month] || 0) + amount

    if (recent.has(month)) {
      entry.recent += quantity
      categoryRecent.set(categoryOf(product), (categoryRecent.get(categoryOf(product)) || 0) + quantity)
    }
  }

  const sum = (values) => values.reduce((total, value) => total + value, 0)

  return [...sales.entries()]
    .map(([id, entry]) => {
      const product = productOf[id]
      const category = categoryOf(product)
      const monthly = shown.map((month) => ({ month, cases: entry.cases[month] || 0, amount: entry.amount[month] || 0 }))
      const last3 = sum(monthly.slice(-3).map((month) => month.cases))
      const before3 = sum(monthly.slice(-6, -3).map((month) => month.cases))
      const share = categoryRecent.get(category) ? entry.recent / categoryRecent.get(category) : 0
      const categoryForecast = forecasts[category] || null

      return {
        id,
        name: product.product_name,
        category,
        monthly,
        cases: sum(monthly.map((month) => month.cases)),
        amount: sum(monthly.map((month) => month.amount)),
        trend: before3 > 0 ? last3 / before3 - 1 : null,
        share,
        recentMonthly: entry.recent / recent.size,
        forecast: categoryForecast
          ? categoryForecast.map((month) => ({ month: month.month, cases: month.cases * share, quick: month.quick * share, slow: month.slow * share }))
          : null,
      }
    })
    .sort((a, b) => b.cases - a.cases || a.name.localeCompare(b.name))
}


// The products likely ordered most in the forecast's first month, from productSales.
function topProducts(sales, limit) {
  return sales
    .filter((row) => row.forecast && row.share > 0)
    .map((row) => ({ id: row.id, name: row.name, category: row.category, recentMonthly: row.recentMonthly, nextMonth: row.forecast[0].cases }))
    .sort((a, b) => b.nextMonth - a.nextMonth || a.name.localeCompare(b.name))
    .slice(0, limit)
}


// Everything the Demand forecast card shows: the months on record and the
// forecast, in all and by category, the check, and the top products of its first month.
// This month so far: the cases in orders placed this month that are past their
// down payment, counted as the months before are, in all ('all') and by
// category; and the orders placed this month still waiting for it. The
// forecast's first month is this month, so this is how it's going.
export function demandThisMonth({ orders = [], items = [], products = [], today = new Date() }) {
  const month = monthOf(today)
  const categoryOf = Object.fromEntries(products.map((product) => [product.id, String(product.category || '').trim() || 'Other']))
  const statusOf = new Map(orders.filter((order) => order.created_at && monthOf(order.created_at) === month).map((order) => [order.id, String(order.status || '').trim().toLowerCase()]))
  const cases = {}
  const waiting = { orders: new Set(), cases: 0 }

  for (const item of items) {
    const status = statusOf.get(item.customer_order_id)
    if (status === undefined) continue
    const quantity = Number(item.quantity) || 0

    if (isDemand(status)) {
      for (const key of ['all', categoryOf[item.product_id] || 'Other']) cases[key] = (cases[key] || 0) + quantity
    } else if (status === 'pending payment') {
      waiting.orders.add(item.customer_order_id)
      waiting.cases += quantity
    }
  }

  return { month, cases, waiting: { orders: waiting.orders.size, cases: waiting.cases } }
}


// =============================================================================
// The month under way, live
// =============================================================================

// The first moment of a month (YYYY-MM) in the Philippines.
const monthStart = (month) => Date.parse(`${month}-01T00:00:00+08:00`)

// The moment a share of the way (0 to 1) through a month.
const momentIn = (month, fraction) => monthStart(month) + fraction * (monthStart(addMonths(month, 1)) - monthStart(month))

// How far through its month a moment is, from 0 to 1.
export function monthFraction(today = new Date()) {
  const month = monthOf(today)
  const length = monthStart(addMonths(month, 1)) - monthStart(month)
  return Math.min(Math.max((new Date(today).getTime() - monthStart(month)) / length, 0), 1)
}

// Every order placed, shaped for asking what was known at a moment: when it
// was placed, when its down payment was sent (its first status change that
// counts as demand; null when none was saved), and its cases by product.
//   history: status changes [{ customer_order_id, new_status, changed_at }]
export function placements({ orders = [], items = [], products = [], history = [] }) {
  const sentAt = new Map()
  for (const entry of history) {
    if (!isDemand(entry.new_status)) continue
    const time = Date.parse(entry.changed_at)
    if (Number.isFinite(time) && !(sentAt.get(entry.customer_order_id) <= time)) sentAt.set(entry.customer_order_id, time)
  }

  const categoryOf = Object.fromEntries(products.map((product) => [product.id, String(product.category || '').trim() || 'Other']))
  const linesOf = new Map()
  for (const item of items) {
    if (!linesOf.has(item.customer_order_id)) linesOf.set(item.customer_order_id, [])
    linesOf.get(item.customer_order_id).push({ productId: item.product_id, category: categoryOf[item.product_id] || 'Other', cases: Number(item.quantity) || 0 })
  }

  return orders
    .filter((order) => order.created_at && !['cancelled', 'draft', ''].includes(normalize(order.status)))
    .map((order) => ({
      id: order.id,
      month: monthOf(order.created_at),
      placedAt: Date.parse(order.created_at),
      sentAt: sentAt.get(order.id) ?? null,
      demand: isDemand(order.status),
      rejected: normalize(order.status) === 'payment rejected',
      lines: linesOf.get(order.id) || [],
    }))
}

// How long an order may wait for its down payment and still be expected to
// send it, as known at a moment: longer than USUAL_WAIT_SHARE of the orders
// paid by then took. 0 with too few to go by, so no waiting order counts.
export function usualWait(placed, moment = Infinity) {
  const waits = placed
    .filter((order) => order.demand && order.sentAt !== null && order.sentAt < moment)
    .map((order) => order.sentAt - order.placedAt)
    .filter((wait) => wait >= 0)
  return waits.length >= MIN_WAITS ? percentile(waits, USUAL_WAIT_SHARE) : 0
}

// The cases placed in a month as known at a moment: in orders whose down
// payment was sent by then, and in orders still waiting for it then, unless
// they'd waited longer than orders do (wait, from usualWait).
// Returns { all, categories: { name: cases }, products: Map } with, inside it,
// waiting: { orders, cases, categories, products }, the part still waiting.
export function placedBy(placed, month, moment, wait = 0) {
  const total = { all: 0, categories: {}, products: new Map(), waiting: { orders: 0, cases: 0, categories: {}, products: new Map() } }
  const add = (into, line) => {
    into.categories[line.category] = (into.categories[line.category] || 0) + line.cases
    into.products.set(line.productId, (into.products.get(line.productId) || 0) + line.cases)
  }

  for (const order of placed) {
    if (order.month !== month || order.placedAt > moment) continue

    const paid = order.demand && (order.sentAt ?? order.placedAt) <= moment
    const waiting = !paid && !order.rejected && moment - order.placedAt <= wait
    if (!paid && !waiting) continue

    for (const line of order.lines) {
      total.all += line.cases
      add(total, line)
      if (waiting) {
        total.waiting.cases += line.cases
        add(total.waiting, line)
      }
    }
    if (waiting) total.waiting.orders++
  }

  return total
}

// The share of a month's cases usually placed by this far through it: over the
// first `count` full months, their cases known by then ÷ their cases in all.
// With few months on record it leans on the plain share of the month's days
// gone: its n months count for n ÷ (n + 5), as a supplier with few deliveries
// leans on every supplier's (utils/predictions.js).
export function shareGone(placed, months, values, count, fraction) {
  let known = 0
  let total = 0

  for (let index = 0; index < count; index++) {
    const moment = momentIn(months[index], fraction)
    known += placedBy(placed, months[index], moment, usualWait(placed, moment)).all
    total += values[index]
  }

  if (!(total > 0)) return fraction
  const own = recordShare(count)
  return own * Math.min(known / total, 1) + (1 - own) * fraction
}

// A month's figure, live: the forecast made from the months before it, moved
// toward what's been placed. Placed so far plus the forecast's share for the
// rest of the month counts for the share of a month usually gone by now; the
// forecast alone for the rest. Never under what's already past its down payment.
//   before: { month, cases, quick, slow }   the forecast from the months before
//   placed: its cases placed so far; paid: those past their down payment
//   strays: { low, high } how far past months ended from their live figure this
//           far through them (straysOf); the likely range is never narrower
export function liveMonth(before, { placed = 0, paid = 0 }, gone, strays = null) {
  const blend = (value) => (1 - gone) * value + gone * (placed + (1 - gone) * value)
  const cases = Math.max(blend(before.cases), paid)
  const quick = Math.min(blend(before.quick), strays ? cases * strays.low : Infinity)
  const slow = Math.max(blend(before.slow), strays ? cases * strays.high : 0)

  return { month: before.month, cases, quick: Math.min(Math.max(quick, paid), cases), slow: Math.max(slow, cases) }
}

// Each full month as it stood this far through it (a share from 0 to 1): its
// forecast and its live figure, both from the months before it only, with how
// it really ended. Oldest first.
function replayMonths(placed, months, values, fraction) {
  const rows = []

  for (let index = MIN_MONTHS; index < values.length; index++) {
    const [before] = forecastSeries(months.slice(0, index), values.slice(0, index), 1) || []
    if (!before || !(values[index] > 0)) continue

    const moment = momentIn(months[index], fraction)
    const known = placedBy(placed, months[index], moment, usualWait(placed, moment))
    const so = { placed: known.all, paid: known.all - known.waiting.cases }
    const gone = shareGone(placed, months, values, index, fraction)
    rows.push({ month: months[index], actual: values[index], before, so, gone, live: liveMonth(before, so, gone).cases })
  }

  return rows
}

// How far months ended from their live figure: the lower and upper quarters of
// (how it ended ÷ its live figure), as the forecast's own range is made. Null
// with fewer than MIN_MONTHS months to go by.
function straysOf(rows) {
  if (rows.length < MIN_MONTHS) return null
  const ratios = rows.map((row) => (row.live > 0 ? row.actual / row.live : 1))
  return { low: Math.min(percentile(ratios, 0.25), 1), high: Math.max(percentile(ratios, 0.75), 1) }
}

// The check: each of the last TESTED_MONTHS full months as it stood this far
// through it (a share from 0 to 1), learning only from the months before it,
// against the forecast made before the month. Average share off of each.
export function checkLiveMonth(placed, months, values, fraction) {
  const rows = replayMonths(placed, months, values, fraction)
  const tests = rows.slice(-TESTED_MONTHS).map((row) => {
    // Its likely range, from the months before it.
    const live = liveMonth(row.before, row.so, row.gone, straysOf(rows.filter((earlier) => earlier.month < row.month)))
    return { month: row.month, actual: row.actual, forecast: row.before.cases, live: live.cases, placed: row.so.placed, inRange: row.actual >= live.quick && row.actual <= live.slow }
  })

  if (!tests.length) return null
  const off = (predicted, actual) => Math.abs(predicted - actual) / actual

  return {
    tests,
    liveOff: mean(tests.map((test) => off(test.live, test.actual))),
    forecastOff: mean(tests.map((test) => off(test.forecast, test.actual))),
    inRangeShare: tests.filter((test) => test.inRange).length / tests.length,
  }
}

// The month under way, live, in all ('all') and by category.
//   forecasts: forecastSeries by key, made from the full months: their first
//              month is the one under way
// Returns null without a forecast to start from; else
//   month, fraction (how far through it), gone (the share usually placed by now)
//   placed    placedBy, now: what's been placed, in all and by category and product
//   strays    how far past months ended from their live figure this far through
//   waitDays  how long an order waiting for its down payment still counts
//   forecast  { key: { month, cases, quick, slow, before, placed, gone, live: true } }
//   check     checkLiveMonth, this far through the month
export function liveDemand({ orders = [], items = [], products = [], history = [], months = [], values = [], forecasts = {}, today = new Date() }) {
  const month = monthOf(today)
  if (!forecasts.all?.length || forecasts.all[0].month !== month) return null

  const placed = placements({ orders, items, products, history })
  const now = new Date(today).getTime()
  const fraction = monthFraction(today)
  const wait = usualWait(placed, now)
  const known = placedBy(placed, month, now, wait)
  const gone = shareGone(placed, months, values, months.length, fraction)
  const strays = straysOf(replayMonths(placed, months, values, fraction))

  const forecast = {}
  for (const [key, series] of Object.entries(forecasts)) {
    if (!series?.length) continue
    const so = key === 'all'
      ? { placed: known.all, paid: known.all - known.waiting.cases }
      : { placed: known.categories[key] || 0, paid: (known.categories[key] || 0) - (known.waiting.categories[key] || 0) }
    forecast[key] = { ...liveMonth(series[0], so, gone, strays), before: series[0], placed: so.placed, gone, live: true }
  }

  return {
    month,
    fraction,
    gone,
    placed: known,
    strays,
    waitDays: wait / DAY,
    forecast,
    check: checkLiveMonth(placed, months, values, fraction),
  }
}


// Sales by product with how often each is ordered (utils/reorderTiming.js
// productTiming), and a row for each product first ordered this month, which
// has no full month of sales yet.
export function withProductTiming(sales = [], timing = null, products = []) {
  if (!timing) return sales
  const productOf = Object.fromEntries(products.map((product) => [product.id, product]))
  const rows = sales.map((row) => ({ ...row, timing: timing.products.get(row.id) || null }))
  const listed = new Set(rows.map((row) => row.id))
  const months = rows[0]?.monthly?.map((entry) => entry.month) || []

  for (const [id, entry] of timing.products) {
    if (listed.has(id) || !entry.thisMonth.orders || !productOf[id]) continue
    rows.push({
      id,
      name: productOf[id].product_name,
      category: String(productOf[id].category || '').trim() || 'Other',
      monthly: months.map((month) => ({ month, cases: 0, amount: 0 })),
      cases: 0,
      amount: 0,
      trend: null,
      share: 0,
      recentMonthly: 0,
      forecast: null,
      newThisMonth: true,
      timing: entry,
    })
  }

  return rows
}


// history (optional): every status change, for when each down payment was sent;
// without it an order counts from the moment it was placed, and none waiting
// for its down payment counts.
// The forecast's first month is the month under way, live (liveDemand): each
// key's first entry, and each product's, carries `before` (the forecast made
// from the months before), `placed` (its cases placed so far) and `live: true`.
export function demandForecast({ orders = [], items = [], products = [], history = [], today = new Date(), topLimit = 10 }) {
  const { months, series } = monthlyDemand({ orders, items, products, today })
  if (!months.length) return { enough: false, months: 0, needed: MIN_MONTHS }

  const forecasts = Object.fromEntries(Object.entries(series).map(([key, values]) => [key, forecastSeries(months, values)]))
  const categories = Object.keys(series)
    .filter((key) => key !== 'all')
    .map((name) => ({ name, total: series[name].reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map(({ name }) => name)

  const sales = productSales({ orders, items, products, months, forecasts })

  // The month under way, live: in all, by category, and for each product from
  // its own cases placed so far.
  const live = liveDemand({ orders, items, products, history, months, values: series.all, forecasts, today })
  if (live) {
    for (const [key, entry] of Object.entries(live.forecast)) forecasts[key] = [entry, ...forecasts[key].slice(1)]

    for (const row of sales) {
      if (!row.forecast?.length) continue
      const placed = live.placed.products.get(row.id) || 0
      const so = { placed, paid: placed - (live.placed.waiting.products.get(row.id) || 0) }
      row.forecast = [{ ...liveMonth(row.forecast[0], so, live.gone, live.strays), before: row.forecast[0], placed, gone: live.gone, live: true }, ...row.forecast.slice(1)]
    }
  }

  return {
    enough: months.length >= MIN_MONTHS,
    months: months.length,
    needed: MIN_MONTHS,
    seasons: months.length >= SEASON_MONTHS,
    history: Object.fromEntries(Object.entries(series).map(([key, values]) => [key, months.map((month, index) => ({ month, cases: values[index] }))])),
    forecast: forecasts,
    check: forecasts.all ? checkForecast(months, series.all) : null,
    // The month under way: how far through it, the share usually placed by
    // now, what's been placed, and how the live figure has checked out.
    live: live ? { month: live.month, fraction: live.fraction, gone: live.gone, waiting: { orders: live.placed.waiting.orders, cases: live.placed.waiting.cases }, waitDays: live.waitDays, check: live.check } : null,
    categories,
    topProducts: topProducts(sales, topLimit),
    productSales: sales,
    thisMonth: demandThisMonth({ orders, items, products, today }),
  }
}
