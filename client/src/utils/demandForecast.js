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
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

export const LEVEL_MONTHS = 6       // the recent level: the last 6 full months
export const FORECAST_MONTHS = 3    // forecast this many months ahead
export const MIN_MONTHS = 3         // full months of orders needed for a forecast
export const SEASON_MONTHS = 12     // and this many before seasons are used
export const TESTED_MONTHS = 6      // the check: the last 6 full months (busy and quiet ones)

// Orders that are real demand: past their down payment, not cancelled.
const NOT_DEMAND = new Set(['', 'draft', 'pending payment', 'payment rejected', 'cancelled'])
const isDemand = (status) => !NOT_DEMAND.has(String(status || '').trim().toLowerCase())

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
//   monthly        its cases and amount (₱) in each of the last 12 full months
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
export function demandForecast({ orders = [], items = [], products = [], today = new Date(), topLimit = 10 }) {
  const { months, series } = monthlyDemand({ orders, items, products, today })
  if (!months.length) return { enough: false, months: 0, needed: MIN_MONTHS }

  const forecasts = Object.fromEntries(Object.entries(series).map(([key, values]) => [key, forecastSeries(months, values)]))
  const categories = Object.keys(series)
    .filter((key) => key !== 'all')
    .map((name) => ({ name, total: series[name].reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map(({ name }) => name)

  const sales = productSales({ orders, items, products, months, forecasts })

  return {
    enough: months.length >= MIN_MONTHS,
    months: months.length,
    needed: MIN_MONTHS,
    seasons: months.length >= SEASON_MONTHS,
    history: Object.fromEntries(Object.entries(series).map(([key, values]) => [key, months.map((month, index) => ({ month, cases: values[index] }))])),
    forecast: forecasts,
    check: forecasts.all ? checkForecast(months, series.all) : null,
    categories,
    topProducts: topProducts(sales, topLimit),
    productSales: sales,
  }
}
