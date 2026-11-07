// =============================================================================
// Simulated history: the generator
//
// Writes db/demo/simulated_history.sql: about a year of made-up orders, supplier
// deliveries, payments and labels, built to behave like DMC's, so the
// predictions have records to learn from for the defense. None of it comes from
// DMC's records. The customers, orders, quantities, prices and dates are all
// made up here, with a fixed random seed, so it comes out the same every time.
// The only real things it uses are the manufacturers and products already in
// the system. The SQL picks those itself when it runs, so no supplier or
// product names are written here or in the SQL file.
//
//   node db/demo/generate-simulated-history.mjs                     (up to today)
//   node db/demo/generate-simulated-history.mjs --today=2026-11-04
//
// Every simulated record is marked: order numbers start SIM-ORD-, PO numbers
// SIM-PO-, and the made-up customers' companies end in "(simulated)", with
// @simulated.example.com emails. They can't sign in: they have no password.
// db/demo/remove_simulated_history.sql takes it all out again.
//
// The times follow what DMC staff said their usual times are (Nov 2026), with
// random variation, for the statistics and the model to find:
//   - a payment check takes a day or two, ordering from suppliers about a week
//   - each supplier promises its own time, from 1 week to 4, and keeps to it
//     most of the time (some suppliers more than others); when late, it's by
//     1 to 4 weeks
//   - a PO given less time than its supplier usually needs comes late
//   - from September to December (the "Ber months") deliveries take up to a
//     few weeks longer, more than the suppliers allow for in their promises
//   - all told, about 1 delivery in 5 comes late, as DMC said
//   - each customer mostly reorders its usual products; an order fills a
//     20-ft container, or now and then a 40-ft
//   - labeling takes about a week for a repeat order in a 20-ft, two weeks in
//     a 40-ft, and three weeks when the customer or one of its products is new
//     (client/src/utils/labelingKind.js), a little more with more products
//   - a container leaves within a day or two of being ready
//   - a few very late deliveries
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT = path.join(here, 'simulated_history.sql')

const SEED = 20261108
const FINISHED_ORDERS = 120
const SUPPLIER_SLOTS = 10
const PRODUCT_SLOTS = 5          // products used from each manufacturer
const MIN_PO_DAYS = 7            // DMC's minimum for a PO's promised date (client/src/utils/dates.js)

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MANILA = 8 * HOUR

const todayArg = process.argv.find((arg) => arg.startsWith('--today='))?.slice('--today='.length)
const TODAY = todayArg || new Date(Date.now() + MANILA).toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) throw new Error('--today must be a date like 2026-11-04')

// Everything happens before 7 a.m. today, Philippine time.
const NOW = Date.parse(`${TODAY}T07:00:00+08:00`)
// From the first day of the month a year back.
const START = (() => {
  const [year, month] = TODAY.split('-').map(Number)
  return Date.parse(`${new Date(Date.UTC(year - 1, month - 1, 1)).toISOString().slice(0, 10)}T09:00:00+08:00`)
})()


// Random numbers, the same every run ------------------------------------------

function mulberry32(seed) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = mulberry32(SEED)
const between = (low, high) => low + (high - low) * random()
const whole = (low, high) => Math.floor(between(low, high + 1))
const chance = (share) => random() < share

function normal() {
  const u = random() || 1e-9
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function uuid() {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = '89ab'[Math.floor(random() * 4)]
  const text = hex.join('')
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}


// Dates, in the Philippines (UTC+8) ------------------------------------------------

const dayOf = (time) => new Date(time + MANILA).toISOString().slice(0, 10)
const hourOf = (time) => ((time + MANILA) % DAY) / HOUR
const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay() // 0 Sunday … 6 Saturday
const monthOf = (time) => new Date(time + MANILA).getUTCMonth() + 1
const atHour = (day, hour) => Date.parse(`${day}T00:00:00+08:00`) + hour * HOUR
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

// September to December: suppliers are slower.
const berMonth = (time) => monthOf(time) >= 9

// The first office moment (Monday to Friday, 9 a.m. to 5 p.m.) at or after a time.
function officeTime(time) {
  let day = dayOf(time)
  let hour = hourOf(time)
  if (hour >= 17) {
    day = addDays(day, 1)
    hour = between(9, 11)
  } else if (hour < 9) {
    hour = between(9, 11)
  }
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) {
    day = addDays(day, 1)
    hour = between(9, 11)
  }
  return atHour(day, hour)
}


// The made-up customers ----------------------------------------------------------

// Made-up shipping costs.
const COUNTRIES = {
  'Hong Kong': { shipping: 60000 },
  Japan: { shipping: 95000 },
  Singapore: { shipping: 70000 },
  Taiwan: { shipping: 80000 },
  'United Arab Emirates': { shipping: 125000 },
  'United States': { shipping: 165000 },
}

const MADE_UP = [
  { slug: 'bluewharf', company: 'Bluewharf Trading', country: 'Hong Kong', location: 'Kwai Chung warehouse', address: 'Unit 1, Sample Logistics Centre, Kwai Chung, Hong Kong', phone: '+852 0000 0101', finished: 15 },
  { slug: 'lanternstreet', company: 'Lantern Street Provisions', country: 'Hong Kong', location: 'Tsuen Wan store', address: 'Shop 2, Sample Street, Tsuen Wan, Hong Kong', phone: '+852 0000 0202', finished: 11 },
  { slug: 'kiritable', company: 'Kiri Table Foods', country: 'Japan', location: 'Osaka distribution centre', address: '1-1 Sample-cho, Osaka, Japan', phone: '+81 00 0000 0303', finished: 14 },
  { slug: 'merlionpantry', company: 'Merlion Pantry Co.', country: 'Singapore', location: 'Jurong warehouse', address: '1 Sample Road, Jurong, Singapore', phone: '+65 0000 0404', finished: 12 },
  { slug: 'jadeharbor', company: 'Jade Harbor Snacks', country: 'Taiwan', location: 'Taoyuan warehouse', address: 'No. 1, Sample Road, Taoyuan, Taiwan', phone: '+886 0 0000 0505', finished: 12 },
  { slug: 'duneandpalm', company: 'Dune and Palm Grocers', country: 'United Arab Emirates', location: 'Al Quoz warehouse', address: 'Warehouse 1, Sample Street, Al Quoz, Dubai, United Arab Emirates', phone: '+971 0 000 0606', finished: 10 },
  { slug: 'bayviewmart', company: 'Bayview Asian Mart', country: 'United States', location: 'Daly City store', address: '1 Sample Avenue, Daly City, CA, United States', phone: '+1 000 000 0707', finished: 13 },
  { slug: 'cedarlane', company: 'Cedar Lane Filipino Foods', country: 'United States', location: 'Jersey City warehouse', address: '1 Sample Street, Jersey City, NJ, United States', phone: '+1 000 000 0808', finished: 11 },
].map((customer, index) => ({
  ...customer,
  key: `made-up-${index + 1}`,
  id: uuid(),
  locationId: uuid(),
  email: `${customer.slug}@simulated.example.com`,
  createdAt: officeTime(START - whole(10, 40) * DAY),
}))

// The system's own customer accounts get some finished orders too, so signing
// in as them shows a history. Their real country isn't known here, so their
// orders follow Hong Kong's pattern. If there are fewer than two, the SQL gives
// these orders to made-up customers instead.
const EXISTING = [
  { key: 'existing-1', country: 'Hong Kong', finished: 13 },
  { key: 'existing-2', country: 'Hong Kong', finished: 9 },
]


// Containers: the placeholder costs of db/migrations/016, and how many cases an
// order filling one has (at about 0.02 m³ a case) ------------------------------

const CONTAINERS = {
  '20-ft': { cost: 80000, cases: [800, 1500] },
  '40-ft': { cost: 120000, cases: [1900, 3000] },
  '40-ft HC': { cost: 130000, cases: [2200, 3300] },
}


// The suppliers' made-up patterns, by position (the SQL matches each position
// to one of the system's manufacturers) ----------------------------------------------

const LEADS = shuffle([7, 9, 12, 14, 16, 18, 21, 21, 24, 28])
const ON_TIME = shuffle([0.97, 0.95, 0.93, 0.92, 0.9, 0.88, 0.85, 0.82, 0.8, 0.75])

const SUPPLIERS = Array.from({ length: SUPPLIER_SLOTS }, (_, index) => ({
  slot: index + 1,
  lead: LEADS[index],
  onTime: ON_TIME[index],
  // When it's late, usually by about this many days.
  lateBy: whole(8, 24),
  // Made-up prices per case for its products.
  prices: Array.from({ length: PRODUCT_SLOTS }, () => Math.round(between(180, 950) / 5) * 5),
}))

const PRODUCTS = SUPPLIERS.flatMap((supplier) => Array.from({ length: PRODUCT_SLOTS }, (_, index) => ({
  supplier,
  productSlot: index + 1,
  key: `${supplier.slot}:${index + 1}`,
})))

// The products each customer usually orders.
for (const customer of [...MADE_UP, ...EXISTING]) customer.usual = shuffle(PRODUCTS).slice(0, whole(4, 7))


// One order: its container and its lines, mostly the customer's usual products
// and now and then a new one, filling the container ------------------------------

function planOrder(customer) {
  const size = chance(0.32) ? (chance(0.25) ? '40-ft HC' : '40-ft') : '20-ft'
  const count = Math.min(customer.usual.length, size === '20-ft' ? whole(2, 4) : whole(3, 5))
  let products = shuffle(customer.usual).slice(0, count)

  if (chance(0.12)) {
    const fresh = shuffle(PRODUCTS).find((product) => !customer.usual.includes(product))
    customer.usual.push(fresh)
    products = [...products.slice(0, Math.max(1, count - 1)), fresh]
  }

  const [low, high] = CONTAINERS[size].cases
  const cases = between(low, high)
  const weights = products.map(() => between(0.5, 1.5))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

  const lines = products.map((product, index) => {
    const price = product.supplier.prices[product.productSlot - 1]
    return {
      id: uuid(),
      supplier: product.supplier,
      productSlot: product.productSlot,
      key: product.key,
      quantity: Math.max(50, Math.round((cases * weights[index]) / totalWeight / 10) * 10),
      price,
      cost: Math.round(price * 0.78 * 100) / 100,
    }
  })

  return { size, lines }
}

// Its labeling kind, as client/src/utils/labelingKind.js works it out: new when
// its customer hadn't ordered one of its products before (ordered: their keys).
function kindOf({ size, lines }, ordered) {
  if (lines.some((line) => !ordered.has(line.key))) return 'new'
  return size === '20-ft' ? 'regular' : 'big'
}


// When each supplier's part arrives, for a PO sent at poTime ---------------------------

function deliveries(lines, poTime, { tight = false } = {}) {
  const bySupplier = new Map()
  for (const line of lines) {
    if (!bySupplier.has(line.supplier.slot)) bySupplier.set(line.supplier.slot, { supplier: line.supplier, lines: [] })
    bySupplier.get(line.supplier.slot).lines.push(line)
  }

  const parts = [...bySupplier.values()]
  const slowest = Math.max(...parts.map((part) => part.supplier.lead))
  const ber = berMonth(poTime)

  // Procurement gives the slowest supplier the time it promises (a little more
  // in the Ber months), and now and then pushes for less, never under DMC's
  // minimum.
  const promisedDays = slowest + (ber ? whole(5, 12) : 0)
  const daysGiven = tight || chance(0.08)
    ? Math.max(MIN_PO_DAYS, promisedDays - whole(4, 9))
    : promisedDays + whole(0, 2)
  const promised = addDays(dayOf(poTime), daysGiven)

  return {
    daysGiven,
    promised,
    parts: parts.map(({ supplier, lines: supplierLines }) => {
      const cases = supplierLines.reduce((sum, line) => sum + line.quantity, 0)

      // Each supplier works to its own time, whatever date it was given: on time
      // most of the time, else late by its usual few weeks. So one given less
      // than it needs comes late.
      let days = supplier.lead + (chance(supplier.onTime) ? -whole(0, 2) : supplier.lateBy + whole(-4, 5))
      if (ber) days += whole(3, 16)                    // the Ber months: slower than promised
      if (cases >= 1500) days += 1                     // big orders
      if (chance(0.02)) days += whole(14, 28)          // a very late one
      days = Math.max(days, 3)

      let receivedDay = addDays(dayOf(poTime), days)
      // No Sunday deliveries: Saturday if that's still on time, else Monday.
      if (weekdayOf(receivedDay) === 0) receivedDay = addDays(receivedDay, receivedDay <= promised ? -1 : 1)

      return {
        supplier,
        lines: supplierLines,
        receivedAt: atHour(receivedDay, between(9, 16.5)),
        paidOn: addDays(dayOf(poTime), whole(1, 3)),
      }
    }),
  }
}


// Labeling, from all goods in to the labels applied ------------------------------------

// DMC's 1, 2 and 3 weeks, less about a day: the labels are done during office
// hours, so a finish on a weekend or an evening counts from the next workday.
const LABELING_DAYS = { regular: 6.2, big: 13.2, new: 20.2 }

function labelingDays(kind, lines) {
  const days = LABELING_DAYS[kind] + 0.4 * (lines.length - 3)
  return Math.max(2, days * Math.max(0.6, 1 + 0.15 * normal()))
}


// A finished order, from start to shipped ---------------------------------------------

function finishedOrder(plan) {
  const { customer, size, lines, kind } = plan
  let createdAt = plan.createdAt

  for (let attempt = 0; ; attempt++) {
    const t0 = officeTime(createdAt)
    const submitted = t0 + between(0.3, 6) * DAY
    const verified = officeTime(submitted + between(0.6, 1.8) * DAY)
    const ordered = officeTime(verified + between(4.5, 8.5) * DAY)
    const po = deliveries(lines, ordered)
    const lastArrival = Math.max(...po.parts.map((part) => part.receivedAt))
    const warehouse = lastArrival + between(0.05, 0.25) * DAY
    const ready = officeTime(warehouse + labelingDays(kind, lines) * DAY)
    const shipped = officeTime(ready + between(0.2, 1.6) * DAY)

    if (shipped < NOW - 0.5 * DAY || attempt > 20) {
      const tight = chance(0.25)
      return {
        customer,
        size,
        lines,
        kind,
        status: 'shipped',
        times: { 'pending payment': t0, submitted, 'payment verified': verified, procurement: ordered, 'warehouse preparation': warehouse, 'ready for shipment': ready, shipped },
        po,
        requested: addDays(dayOf(t0), tight ? whole(35, 45) : whole(55, 90)),
        labels: 'applied to units',
      }
    }

    // It ran past today: start it earlier.
    createdAt -= shipped - NOW + 3 * DAY
  }
}


// The orders under way today, one or more in every step, some at risk -----------------

const ACTIVE = [
  { status: 'pending payment', age: 1.2 },
  { status: 'pending payment', age: 3.5, tight: true },
  { status: 'submitted', age: 0.3 },
  { status: 'submitted', age: 3.4 },                                       // stuck in the payment check
  { status: 'payment verified', age: 2 },
  { status: 'payment verified', age: 11 },                                 // the POs are late going out
  { status: 'procurement', age: 5 },
  { status: 'procurement', age: 13 },
  { status: 'procurement', age: 24, overdue: true },                       // a delivery is overdue
  { status: 'procurement', age: 30, tight: true },
  { status: 'warehouse preparation', age: 2, labels: 'original label received' },
  { status: 'warehouse preparation', age: 6, labels: 'printed & awaiting application' },
  { status: 'warehouse preparation', age: 30, tight: true, labels: 'awaiting customer translated design' }, // labeling is taking long
  { status: 'ready for shipment', age: 0.4 },
  { status: 'ready for shipment', age: 2.5 },
]

const STEPS = ['pending payment', 'submitted', 'payment verified', 'procurement', 'warehouse preparation', 'ready for shipment', 'shipped']

// Worked out backwards from when it entered its current step.
function activeOrder(plan) {
  const { customer, size, lines, kind } = plan
  const step = STEPS.indexOf(plan.status)
  const entered = NOW - plan.age * DAY
  const times = { [plan.status]: entered }
  let po = null

  if (step >= 4) {
    // In the warehouse: every supplier delivered before it got there.
    const warehouse = step === 4 ? entered : entered - labelingDays(kind, lines) * DAY
    let ordered = officeTime(warehouse - 35 * DAY)
    po = deliveries(lines, ordered)

    // Move the whole PO (sent, promised, delivered) by whole days, so the last
    // delivery comes just before the warehouse step.
    const lastArrival = Math.max(...po.parts.map((part) => part.receivedAt))
    const shiftDays = Math.round((lastArrival - (warehouse - between(0.05, 0.25) * DAY)) / DAY)
    ordered -= shiftDays * DAY
    po.promised = addDays(po.promised, -shiftDays)
    po.parts.forEach((part) => {
      part.receivedAt -= shiftDays * DAY
      part.paidOn = addDays(part.paidOn, -shiftDays)
    })

    times.procurement = ordered
    // The order moved on when the last delivery came in.
    times['warehouse preparation'] = Math.max(...po.parts.map((part) => part.receivedAt)) + between(0.05, 0.25) * DAY
  }

  if (step === 3) {
    times.procurement = entered
    po = deliveries(lines, entered, { tight: plan.overdue || plan.tight })
    // Some deliveries are in by now, but never all (the order would have moved on).
    const open = po.parts.filter((part) => part.receivedAt >= NOW)
    if (!open.length) {
      const last = po.parts.reduce((latest, part) => (part.receivedAt > latest.receivedAt ? part : latest))
      last.receivedAt = NOW + between(1, 4) * DAY
    }
    if (plan.overdue) {
      // The slowest supplier is past its promised date and hasn't delivered.
      po.promised = addDays(dayOf(NOW), -whole(3, 6))
      const last = po.parts.reduce((latest, part) => (part.receivedAt > latest.receivedAt ? part : latest))
      last.receivedAt = NOW + 3 * DAY
    }
  }

  // The earlier steps, backwards.
  const first = Math.min(...Object.values(times))
  const before = STEPS.slice(0, STEPS.indexOf(Object.keys(times).find((key) => times[key] === first)))
  let time = first
  for (const earlier of [...before].reverse()) {
    const length = { 'pending payment': between(0.3, 4), submitted: between(0.6, 1.8), 'payment verified': between(4.5, 8.5) }[earlier] || 1
    time -= length * DAY
    times[earlier] = time
  }

  return {
    customer,
    size,
    lines,
    kind,
    status: plan.status,
    times,
    po,
    requested: addDays(dayOf(times['pending payment']), plan.tight ? whole(30, 40) : whole(60, 90)),
    labels: plan.labels || (step >= 5 ? 'applied to units' : null),
  }
}


// Every order --------------------------------------------------------------------

const orders = []

const finishedPlan = [
  ...MADE_UP.flatMap((customer) => Array.from({ length: customer.finished }, () => customer)),
  ...EXISTING.flatMap((customer) => Array.from({ length: customer.finished }, () => customer)),
]
if (finishedPlan.length !== FINISHED_ORDERS) throw new Error(`Expected ${FINISHED_ORDERS} finished orders, planned ${finishedPlan.length}`)

// When each starts (the last about two months back, so orders ship in every
// month up to now), then their products in the order each customer placed them,
// so each order knows whether it's new to its customer.
const lastStart = NOW - 75 * DAY
const plans = shuffle(finishedPlan)
  .map((customer) => ({ customer, createdAt: between(START, lastStart) }))
  .sort((a, b) => a.createdAt - b.createdAt)

const orderedBy = new Map()
const productsOrdered = (customer) => {
  if (!orderedBy.has(customer.key)) orderedBy.set(customer.key, new Set())
  return orderedBy.get(customer.key)
}

for (const plan of plans) {
  Object.assign(plan, planOrder(plan.customer))
  const ordered = productsOrdered(plan.customer)
  plan.kind = kindOf(plan, ordered)
  plan.lines.forEach((line) => ordered.add(line.key))
  orders.push(finishedOrder(plan))
}

// The orders under way belong to made-up customers only, so the system's own
// customer accounts keep their real balances. The older ones first.
ACTIVE.map((plan, index) => ({ ...plan, customer: MADE_UP[index % MADE_UP.length] }))
  .sort((a, b) => STEPS.indexOf(b.status) - STEPS.indexOf(a.status) || b.age - a.age)
  .forEach((plan) => {
    Object.assign(plan, planOrder(plan.customer))
    const ordered = productsOrdered(plan.customer)
    plan.kind = kindOf(plan, ordered)
    plan.lines.forEach((line) => ordered.add(line.key))
    orders.push(activeOrder(plan))
  })

orders.sort((a, b) => a.times['pending payment'] - b.times['pending payment'])

// Moves an order back by whole weeks (so its weekdays stay the same).
function shiftOrder(order, days) {
  for (const key of Object.keys(order.times)) order.times[key] -= days * DAY
  order.requested = addDays(order.requested, -days)
  if (order.po) {
    order.po.promised = addDays(order.po.promised, -days)
    order.po.parts.forEach((part) => {
      part.receivedAt -= days * DAY
      part.paidOn = addDays(part.paidOn, -days)
    })
  }
}

// An order that ran past today started earlier, so a customer's orders can end
// up in another order than planned. Each order's kind again, from the final
// dates, as the system will work them out: a finished one whose kind changed
// gets that kind's labeling time (moved back by whole weeks if it would then
// run past today). Until nothing changes.
function settleKinds() {
  for (let round = 0; round < 8; round++) {
    orders.sort((a, b) => a.times['pending payment'] - b.times['pending payment'])
    const seen = new Map()
    let changed = 0

    for (const order of orders) {
      if (!seen.has(order.customer.key)) seen.set(order.customer.key, new Set())
      const ordered = seen.get(order.customer.key)
      const kind = kindOf(order, ordered)
      order.lines.forEach((line) => ordered.add(line.key))
      if (kind === order.kind) continue

      changed++
      order.kind = kind
      if (order.status !== 'shipped') continue

      const ready = officeTime(order.times['warehouse preparation'] + labelingDays(kind, order.lines) * DAY)
      order.times['ready for shipment'] = ready
      order.times.shipped = officeTime(ready + between(0.2, 1.6) * DAY)
      const over = order.times.shipped - (NOW - 0.5 * DAY)
      if (over > 0) shiftOrder(order, Math.ceil(over / (7 * DAY)) * 7)
    }

    if (!changed) return
  }
}
settleKinds()
orders.sort((a, b) => a.times['pending payment'] - b.times['pending payment'])

// The kinds again, from the final dates, as the system will work them out.
const kindMismatches = (() => {
  const seen = new Map()
  let mismatches = 0
  for (const order of orders) {
    if (!seen.has(order.customer.key)) seen.set(order.customer.key, new Set())
    const ordered = seen.get(order.customer.key)
    if (kindOf(order, ordered) !== order.kind) mismatches++
    order.lines.forEach((line) => ordered.add(line.key))
  }
  return mismatches
})()


// Numbers, totals and rows --------------------------------------------------------

const counters = {}
const nextNumber = (prefix, time) => {
  const year = dayOf(time).slice(0, 4)
  const key = `${prefix}-${year}`
  counters[key] = (counters[key] || 0) + 1
  return `SIM-${prefix}-${year}-${String(counters[key]).padStart(4, '0')}`
}

const rows = { orders: [], items: [], history: [], pos: [], poLines: [], labels: [] }
const money = (value) => Math.round(value * 100) / 100

for (const order of orders) {
  order.id = uuid()
  const created = order.times['pending payment']
  order.number = nextNumber('ORD', created)
  const quotationNumber = order.number.replace('SIM-ORD-', 'SIM-QT-')

  const subtotal = money(order.lines.reduce((sum, line) => sum + line.quantity * line.price, 0))
  const shipping = COUNTRIES[order.customer.country].shipping
  const containerCost = CONTAINERS[order.size].cost
  const total = money(subtotal + containerCost + shipping)
  const downPayment = money(total / 2)
  const step = STEPS.indexOf(order.status)

  const settled = order.status === 'shipped' ? total
    : order.status === 'ready for shipment' ? (chance(0.5) ? total : downPayment)
      : step >= 2 ? downPayment : 0
  const pending = order.status === 'submitted' ? downPayment : 0

  rows.orders.push({
    id: order.id,
    customerKey: order.customer.key,
    quotationNumber,
    number: order.number,
    subtotal,
    shipping,
    containerSize: order.size,
    containerCost,
    total,
    downPayment,
    settled,
    pending,
    status: order.status,
    createdAt: created,
    requested: order.requested,
    shippedOn: order.status === 'shipped' ? dayOf(order.times.shipped) : null,
  })

  for (const line of order.lines) {
    rows.items.push({ id: line.id, orderId: order.id, supplierSlot: line.supplier.slot, productSlot: line.productSlot, quantity: line.quantity, price: line.price, subtotal: money(line.quantity * line.price) })
  }

  // Each step it went through.
  let previous = null
  for (const status of STEPS) {
    const time = order.times[status]
    if (time === undefined) break
    rows.history.push({ orderId: order.id, previous, next: status, at: time })
    previous = status
  }

  // Its purchase order and each supplier's delivery.
  if (order.po) {
    const poTime = order.times.procurement
    const poId = uuid()
    const received = order.po.parts.filter((part) => part.receivedAt < NOW)
    const allIn = received.length === order.po.parts.length
    const paid = NOW - poTime > 2.5 * DAY
    const poStatus = allIn ? 'fully delivered' : received.length ? 'partially delivered' : paid ? 'awaiting delivery' : 'sent to supplier'
    const lastChange = allIn ? Math.max(...received.map((part) => part.receivedAt)) : received.length ? Math.max(...received.map((part) => part.receivedAt)) : poTime

    rows.pos.push({ id: poId, orderId: order.id, number: nextNumber('PO', poTime), status: poStatus, createdAt: poTime, updatedAt: lastChange, promised: order.po.promised })

    for (const part of order.po.parts) {
      const isIn = part.receivedAt < NOW
      for (const line of part.lines) {
        rows.poLines.push({
          id: uuid(),
          poId,
          supplierSlot: line.supplier.slot,
          productSlot: line.productSlot,
          ordered: line.quantity,
          received: isIn ? line.quantity : 0,
          cost: line.cost,
          status: isIn ? 'fully delivered' : paid ? 'awaiting delivery' : 'sent to supplier',
          createdAt: poTime,
          updatedAt: isIn ? part.receivedAt : poTime,
          pfi: paid || isIn ? money(line.quantity * line.cost) : 0,
          paidAmount: paid || isIn ? money(line.quantity * line.cost) : 0,
          paidOn: paid || isIn ? part.paidOn : null,
          condition: isIn ? 'good' : null,
          receivedAt: isIn ? part.receivedAt : null,
        })
      }
    }
  }

  // Its labels, once the goods are in the warehouse.
  if (order.labels) {
    const warehouse = order.times['warehouse preparation']
    const done = order.times['ready for shipment']
    for (const line of order.lines) {
      rows.labels.push({
        itemId: line.id,
        status: order.labels,
        createdAt: warehouse + between(0.1, 0.4) * DAY,
        updatedAt: done ? done - between(0.05, 0.3) * DAY : Math.min(NOW - 0.1 * DAY, warehouse + between(0.5, 2) * DAY),
      })
    }
  }
}

// How the made-up deliveries turned out, for the summary.
const deliveryStats = (() => {
  let count = 0
  let late = 0
  for (const order of orders) {
    if (!order.po) continue
    for (const part of order.po.parts) {
      if (part.receivedAt >= NOW) continue
      count++
      if (dayOf(part.receivedAt) > order.po.promised) late++
    }
  }
  return { count, late }
})()
const kindCounts = orders.filter((order) => order.status === 'shipped').reduce((counts, order) => ({ ...counts, [order.kind]: (counts[order.kind] || 0) + 1 }), {})
// Orders shipped each month, so every month has some.
const shippedByMonth = orders.filter((order) => order.status === 'shipped').reduce((months, order) => {
  const month = dayOf(order.times.shipped).slice(0, 7)
  return { ...months, [month]: (months[month] || 0) + 1 }
}, {})


// The SQL --------------------------------------------------------------------------

const text = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`)
const stamp = (time) => (time === null || time === undefined ? 'null' : text(new Date(Math.round(time)).toISOString()))
const amount = (value) => (value === null || value === undefined ? 'null' : money(value).toFixed(2))

function valuesInsert(header, columns, list, render, footer = '') {
  if (!list.length) return ''
  const chunks = []
  for (let index = 0; index < list.length; index += 400) {
    const values = list.slice(index, index + 400).map((row) => `  (${render(row).join(', ')})`).join(',\n')
    chunks.push(`${header}\nfrom (values\n${values}\n) as v(${columns})${footer ? `\n${footer}` : ''};\n`)
  }
  return chunks.join('\n')
}

const finished = orders.filter((order) => order.status === 'shipped').length
const deliveryCount = rows.pos.reduce((sum, po) => sum + new Set(rows.poLines.filter((line) => line.poId === po.id).map((line) => line.supplierSlot)).size, 0)

const sql = `-- =============================================================================
-- Simulated history: about a year of made-up orders, for the predictions
-- =============================================================================
-- Made by db/demo/generate-simulated-history.mjs (seed ${SEED}) on ${TODAY}.
-- Run it once in the Supabase SQL editor (project scotywfepxfispgpauwm), after
-- 019. It's all or nothing: if any line fails, nothing is added.
--
-- None of it is DMC's: the customers, orders, quantities, prices and dates are
-- made up. It uses the manufacturers and products already in the system, picked
-- here when it runs, so supplier scores next to real names come from made-up
-- deliveries. The pages say "Simulated data" while any of it is in.
--
-- What it adds (${dayOf(START)} to ${TODAY}):
--   ${MADE_UP.length} made-up customers, with a delivery address each (they can't sign in)
--   ${finished} finished orders and ${orders.length - finished} under way, in every step
--   ${rows.pos.length} purchase orders: ${deliveryCount} supplier deliveries
--   payments, labels and every status change, with dates
-- Its times follow DMC staff's usual times; see the generator for how.
--
-- Marked: order numbers SIM-ORD-…, PO numbers SIM-PO-…, companies "(simulated)",
-- emails @simulated.example.com. To take it all out:
-- db/demo/remove_simulated_history.sql.
-- =============================================================================

begin;


-- Once only ------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.customer_orders where order_number like 'SIM-ORD-%') then
    raise exception 'The simulated history is already in. To load it again, run db/demo/remove_simulated_history.sql first.';
  end if;
end $$;


-- The manufacturers and products it uses, in a fixed order --------------------
create temp table sim_supplier on commit drop as
select s.id, row_number() over (order by s.created_at, s.id) as slot
from public.suppliers s
where lower(trim(s.supplier_type)) = 'manufacturer'
  and exists (select 1 from public.products p where p.supplier_id = s.id);

do $$
begin
  if not exists (select 1 from sim_supplier) then
    raise exception 'No manufacturer has products yet. Add some first.';
  end if;
end $$;

-- ${SUPPLIER_SLOTS} made-up supplier patterns, shared out among the manufacturers.
create temp table sim_slot on commit drop as
select g as sim_slot, ((g - 1) % c.n) + 1 as real_slot
from generate_series(1, ${SUPPLIER_SLOTS}) g, (select count(*) as n from sim_supplier) c;

create temp table sim_product on commit drop as
select p.id, p.supplier_id, s.slot as supplier_slot,
       row_number() over (partition by p.supplier_id order by p.created_at, p.id) as slot,
       count(*) over (partition by p.supplier_id) as in_supplier
from public.products p
join sim_supplier s on s.id = p.supplier_id;


-- Checks that would refuse history ------------------------------------------------
-- Past orders aren't new orders: no credit limit, no price-list check, and PO
-- numbers of their own instead of the next real ones. Back on at the end.
alter table public.customer_orders disable trigger customer_orders_credit_limit;
alter table public.purchase_order_items disable trigger purchase_order_items_price_list;
alter table public.purchase_orders disable trigger purchase_orders_number;


-- The made-up customers ---------------------------------------------------------
-- A sign-in record each (Supabase needs one for every profile) with no password,
-- so no one can sign in as them.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
${MADE_UP.map((customer) => `  ('00000000-0000-0000-0000-000000000000', ${text(customer.id)}, 'authenticated', 'authenticated', ${text(customer.email)}, '', '{"provider": "email", "providers": ["email"], "simulated": true}', '{"simulated": true}', ${stamp(customer.createdAt)}, ${stamp(customer.createdAt)}, '', '', '', '')`).join(',\n')};

insert into public.profiles (id, name, email, company, contact_number, address, country, role, created_at, is_active)
values
${MADE_UP.map((customer) => `  (${text(customer.id)}, ${text(`${customer.company} purchasing`)}, ${text(customer.email)}, ${text(`${customer.company} (simulated)`)}, ${text(customer.phone)}, ${text(customer.address)}, ${text(customer.country)}, 'customer', ${stamp(customer.createdAt)}, true)`).join(',\n')}
on conflict (id) do update
  set name = excluded.name, company = excluded.company, contact_number = excluded.contact_number,
      address = excluded.address, country = excluded.country, role = 'customer', is_active = true;

insert into public.delivery_locations (id, profile_id, location_name, recipient_name, contact_number, address, country, created_at)
values
${MADE_UP.map((customer) => `  (${text(customer.locationId)}, ${text(customer.id)}, ${text(customer.location)}, ${text(`${customer.company} receiving`)}, ${text(customer.phone)}, ${text(customer.address)}, ${text(customer.country)}, ${stamp(customer.createdAt)})`).join(',\n')};

-- Who each order belongs to: the made-up customers, and up to two of the
-- system's own customer accounts (else made-up ones).
create temp table sim_customer (key text primary key, id uuid not null, location_id uuid) on commit drop;

insert into sim_customer (key, id, location_id)
values
${MADE_UP.map((customer) => `  (${text(customer.key)}, ${text(customer.id)}, ${text(customer.locationId)})`).join(',\n')};

insert into sim_customer (key, id, location_id)
select 'existing-' || e.slot, e.id,
       (select l.id from public.delivery_locations l
        where l.profile_id = e.id and not coalesce(l.is_archived, false)
        order by l.created_at, l.id limit 1)
from (
  select p.id, row_number() over (order by p.created_at, p.id) as slot
  from public.profiles p
  where lower(trim(p.role)) = 'customer' and p.email not like '%@simulated.example.com'
) e
where e.slot <= ${EXISTING.length};

insert into sim_customer (key, id, location_id)
select f.key, m.id, m.location_id
from (values ('existing-1', 'made-up-1'), ('existing-2', 'made-up-4')) as f(key, fallback)
join sim_customer m on m.key = f.fallback
where not exists (select 1 from sim_customer s where s.key = f.key);


-- Orders -----------------------------------------------------------------------------
${valuesInsert(
  `insert into public.customer_orders (id, customer_id, delivery_location_id, quotation_number, order_number, subtotal, shipping_cost, container_size, container_cost, total_amount, down_payment_amount, settled_amount, pending_payment_amount, status, created_at, requested_ship_date, estimated_ship_date)
select v.id::uuid, c.id, c.location_id, v.quotation_number, v.order_number, v.subtotal, v.shipping, v.container_size, v.container_cost, v.total, v.down_payment, v.settled, v.pending, v.status, v.created_at::timestamptz, v.requested::date, v.shipped_on::date`,
  'id, customer_key, quotation_number, order_number, subtotal, shipping, container_size, container_cost, total, down_payment, settled, pending, status, created_at, requested, shipped_on',
  rows.orders,
  (row) => [text(row.id), text(row.customerKey), text(row.quotationNumber), text(row.number), amount(row.subtotal), amount(row.shipping), text(row.containerSize), amount(row.containerCost), amount(row.total), amount(row.downPayment), amount(row.settled), amount(row.pending), text(row.status), stamp(row.createdAt), text(row.requested), text(row.shippedOn)],
  'join sim_customer c on c.key = v.customer_key',
)}

-- Their products -----------------------------------------------------------------------
${valuesInsert(
  `insert into public.customer_order_items (id, customer_order_id, product_id, quantity, unit_price, subtotal)
select v.id::uuid, v.order_id::uuid, p.id, v.quantity, v.unit_price, v.subtotal`,
  'id, order_id, supplier_slot, product_slot, quantity, unit_price, subtotal',
  rows.items,
  (row) => [text(row.id), text(row.orderId), row.supplierSlot, row.productSlot, row.quantity, amount(row.price), amount(row.subtotal)],
  `join sim_slot s on s.sim_slot = v.supplier_slot
join sim_product p on p.supplier_slot = s.real_slot and p.slot = ((v.product_slot - 1) % p.in_supplier) + 1`,
)}

-- Every status change ---------------------------------------------------------------------
${valuesInsert(
  `insert into public.customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
select v.order_id::uuid, v.previous, v.next, v.changed_at::timestamptz`,
  'order_id, previous, next, changed_at',
  rows.history,
  (row) => [text(row.orderId), text(row.previous), text(row.next), stamp(row.at)],
)}

-- Purchase orders ------------------------------------------------------------------------
${valuesInsert(
  `insert into public.purchase_orders (id, customer_order_id, po_number, status, created_at, updated_at, expected_delivery_date)
select v.id::uuid, v.order_id::uuid, v.po_number, v.status, v.created_at::timestamptz, v.updated_at::timestamptz, v.promised::date`,
  'id, order_id, po_number, status, created_at, updated_at, promised',
  rows.pos,
  (row) => [text(row.id), text(row.orderId), text(row.number), text(row.status), stamp(row.createdAt), stamp(row.updatedAt), text(row.promised)],
)}

-- Their lines: what each supplier was asked for, paid and delivered ----------------------------
${valuesInsert(
  `insert into public.purchase_order_items (id, purchase_order_id, product_id, supplier_id, ordered_quantity, received_quantity, unit_price, status, created_at, updated_at, supplier_pfi_amount, payment_amount, payment_date, received_condition, fully_received_at)
select v.id::uuid, v.po_id::uuid, p.id, p.supplier_id, v.ordered, v.received, v.unit_price, v.status, v.created_at::timestamptz, v.updated_at::timestamptz, v.pfi, v.paid, v.paid_on::date, v.condition, v.received_at::timestamptz`,
  'id, po_id, supplier_slot, product_slot, ordered, received, unit_price, status, created_at, updated_at, pfi, paid, paid_on, condition, received_at',
  rows.poLines,
  (row) => [text(row.id), text(row.poId), row.supplierSlot, row.productSlot, row.ordered, row.received, amount(row.cost), text(row.status), stamp(row.createdAt), stamp(row.updatedAt), amount(row.pfi), amount(row.paidAmount), text(row.paidOn), text(row.condition), stamp(row.receivedAt)],
  `join sim_slot s on s.sim_slot = v.supplier_slot
join sim_product p on p.supplier_slot = s.real_slot and p.slot = ((v.product_slot - 1) % p.in_supplier) + 1`,
)}

-- Compliance labels ---------------------------------------------------------------------------
${valuesInsert(
  `insert into public.compliance_label_exchanges (customer_order_item_id, status, created_at, updated_at)
select v.item_id::uuid, v.status, v.created_at::timestamptz, v.updated_at::timestamptz`,
  'item_id, status, created_at, updated_at',
  rows.labels,
  (row) => [text(row.itemId), text(row.status), stamp(row.createdAt), stamp(row.updatedAt)],
)}

-- The checks back on ----------------------------------------------------------------------------
alter table public.customer_orders enable trigger customer_orders_credit_limit;
alter table public.purchase_order_items enable trigger purchase_order_items_price_list;
alter table public.purchase_orders enable trigger purchase_orders_number;


-- Everything went in, or nothing does --------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.customer_orders where order_number like 'SIM-ORD-%';
  if v_count <> ${rows.orders.length} then raise exception 'Expected ${rows.orders.length} simulated orders, made %.', v_count; end if;

  select count(*) into v_count from public.customer_order_items i join public.customer_orders o on o.id = i.customer_order_id where o.order_number like 'SIM-ORD-%';
  if v_count <> ${rows.items.length} then raise exception 'Expected ${rows.items.length} order lines, made %.', v_count; end if;

  select count(*) into v_count from public.purchase_order_items i join public.purchase_orders p on p.id = i.purchase_order_id where p.po_number like 'SIM-PO-%';
  if v_count <> ${rows.poLines.length} then raise exception 'Expected ${rows.poLines.length} PO lines, made %.', v_count; end if;

  select count(*) into v_count from public.customer_order_status_history h join public.customer_orders o on o.id = h.customer_order_id where o.order_number like 'SIM-ORD-%';
  if v_count <> ${rows.history.length} then raise exception 'Expected ${rows.history.length} status changes, made %.', v_count; end if;
end $$;


commit;


-- Check ------------------------------------------------------------------------------------
-- Expect: ${MADE_UP.length} made-up customers, ${finished} finished orders, ${orders.length - finished} under way, ${rows.pos.length} purchase
-- orders, ${deliveryCount} supplier deliveries (a few may merge if there are fewer than
-- ${SUPPLIER_SLOTS} manufacturers), ${rows.history.length} status changes.
select 'made-up customers' as what, count(*) as how_many from public.profiles where email like '%@simulated.example.com'
union all
select 'finished orders', count(*) from public.customer_orders where order_number like 'SIM-ORD-%' and status = 'shipped'
union all
select 'orders under way', count(*) from public.customer_orders where order_number like 'SIM-ORD-%' and status <> 'shipped'
union all
select 'purchase orders', count(*) from public.purchase_orders where po_number like 'SIM-PO-%'
union all
select 'supplier deliveries', count(distinct (i.purchase_order_id, i.supplier_id)) from public.purchase_order_items i join public.purchase_orders p on p.id = i.purchase_order_id where p.po_number like 'SIM-PO-%'
union all
select 'status changes', count(*) from public.customer_order_status_history h join public.customer_orders o on o.id = h.customer_order_id where o.order_number like 'SIM-ORD-%';
`

fs.writeFileSync(OUTPUT, sql)

console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${Math.round(sql.length / 1024)} KB), ${dayOf(START)} to ${TODAY}:`)
console.log(`  ${MADE_UP.length} made-up customers, ${finished} finished orders, ${orders.length - finished} under way`)
console.log(`  ${rows.items.length} order lines, ${rows.pos.length} POs, ${rows.poLines.length} PO lines, ${deliveryCount} supplier deliveries, ${rows.labels.length} label records, ${rows.history.length} status changes`)
console.log(`  Deliveries in: ${deliveryStats.count}, late: ${deliveryStats.late} (${Math.round((100 * deliveryStats.late) / deliveryStats.count)}%)`)
console.log(`  Finished orders by labeling kind: ${Object.entries(kindCounts).map(([kind, count]) => `${kind} ${count}`).join(', ')}; kinds changed by the final dates: ${kindMismatches}`)
console.log(`  Shipped by month: ${Object.entries(shippedByMonth).sort().map(([month, count]) => `${month} ${count}`).join(', ')}`)
console.log('  Supplier patterns (position: usual lead days, on-time share, late by):')
console.log(`  ${SUPPLIERS.map((supplier) => `${supplier.slot}: ${supplier.lead}d ${Math.round(supplier.onTime * 100)}% +${supplier.lateBy}d`).join(' · ')}`)
