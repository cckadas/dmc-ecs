// =============================================================================
// Simulated history: the generator
//
// Writes db/demo/simulated_history.sql: 16 months of made-up orders, supplier
// deliveries, payments and labels, built to behave like DMC's, so the
// predictions have records to learn from for the defense. 16 months, so every
// month of the year has been seen once before it comes round again: a busy
// season can only be predicted, and that prediction checked, once it has
// happened before.
//
// None of it comes from DMC's records. The customers, orders, quantities,
// prices and dates are all made up here, with a fixed random seed, so it comes
// out the same every time.
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
//   - each customer reorders at its own pace, every few weeks give or take a
//     few days, and mostly its usual products
//   - more is ordered in the months before Christmas and less over the
//     holidays: customers order a little sooner then, and more of their orders
//     fill a 40-ft container instead of a 20-ft
//   - labeling takes about a week for a repeat order in a 20-ft, two weeks in
//     a 40-ft, and three weeks when the customer or one of its products is new
//     (client/src/utils/labelingKind.js), a little more with more products
//   - each label goes through its steps, and each customer takes its own
//     time to send back its translated design
//   - the down payment comes a few days after the order, the balance in the
//     days before the container ships
//   - a container leaves within a day or two of being ready
//   - a few very late deliveries
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT = path.join(here, 'simulated_history.sql')

const SEED = 20261108
const HISTORY_MONTHS = 16
const FINISHED_ORDERS = 80
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
// From the first day of the month, HISTORY_MONTHS back.
const START = (() => {
  const [year, month] = TODAY.split('-').map(Number)
  return Date.parse(`${new Date(Date.UTC(year, month - 1 - HISTORY_MONTHS, 1)).toISOString().slice(0, 10)}T09:00:00+08:00`)
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

function uuid(pick = random) {
  const hex = Array.from({ length: 32 }, () => Math.floor(pick() * 16).toString(16))
  hex[12] = '4'
  hex[16] = '89ab'[Math.floor(pick() * 4)]
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
function officeTime(time, pick = between) {
  let day = dayOf(time)
  let hour = hourOf(time)
  if (hour >= 17) {
    day = addDays(day, 1)
    hour = pick(9, 11)
  } else if (hour < 9) {
    hour = pick(9, 11)
  }
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) {
    day = addDays(day, 1)
    hour = pick(9, 11)
  }
  return atHour(day, hour)
}


// The made-up customers ----------------------------------------------------------

// Made-up shipping costs.
const COUNTRIES = {
  Macau: { shipping: 60000 },
  Taiwan: { shipping: 80000 },
  Japan: { shipping: 95000 },
  Australia: { shipping: 120000 },
  Canada: { shipping: 150000 },
}

// Made-up days at sea to each country, roughly by distance: the arrivals staff
// would record on shipped orders (db/migrations/025). The estimates never read
// these numbers; they learn them back from the recorded arrivals.
const SAILING = {
  Macau: [2, 4],
  Taiwan: [3, 5],
  Japan: [5, 9],
  Australia: [10, 16],
  Canada: [18, 26],
}

// The arrivals have random numbers of their own, so the rest of the history
// comes out exactly as it did before arrivals were recorded.
const arrivalRandom = mulberry32(SEED + 25)

// When a shipped order's container arrived and staff recorded it (the same
// day to two days later, in office hours). Null while it's still at sea or
// not recorded yet.
function arrivalOf(order) {
  const [low, high] = SAILING[order.customer.country] || [5, 10]
  const arrivedAt = order.times.shipped + Math.round(low + (high - low) * arrivalRandom()) * DAY
  const recordDay = addDays(dayOf(arrivedAt), Math.floor(arrivalRandom() * 3))
  const recordedAt = atHour(recordDay, 9 + arrivalRandom() * 8)
  return recordedAt <= NOW ? { day: dayOf(arrivedAt), recordedAt } : null
}

// Five made-up customers, in DMC's markets, each ordering at its own pace:
// from about every 2½ weeks (Japan) to about every 6 weeks (Canada).
const MADE_UP = [
  { slug: 'lotusharbour', company: 'Lotus Harbour Trading', country: 'Macau', location: 'Taipa warehouse', address: 'Unit 1, Sample Industrial Centre, Taipa, Macau', phone: '+853 0000 0101', finished: 15 },
  { slug: 'jadeharbor', company: 'Jade Harbor Snacks', country: 'Taiwan', location: 'Taoyuan warehouse', address: 'No. 1, Sample Road, Taoyuan, Taiwan', phone: '+886 0 0000 0202', finished: 18 },
  { slug: 'kiritable', company: 'Kiri Table Foods', country: 'Japan', location: 'Osaka distribution centre', address: '1-1 Sample-cho, Osaka, Japan', phone: '+81 00 0000 0303', finished: 24 },
  { slug: 'southerncross', company: 'Southern Cross Pantry', country: 'Australia', location: 'Botany warehouse', address: '1 Sample Road, Botany, NSW, Australia', phone: '+61 0 0000 0404', finished: 13 },
  { slug: 'maplelane', company: 'Maple Lane Filipino Foods', country: 'Canada', location: 'Richmond store', address: '1 Sample Way, Richmond, BC, Canada', phone: '+1 000 000 0505', finished: 10 },
].map((customer, index) => ({
  ...customer,
  key: `made-up-${index + 1}`,
  id: uuid(),
  locationId: uuid(),
  email: `${customer.slug}@simulated.example.com`,
  createdAt: officeTime(START - whole(10, 40) * DAY),
}))

// The system's own customer accounts get none of it: their records stay their
// own, and the predictions see the made-up history apart from them.


// Each label's steps and every payment have random numbers of their own.
const recordRandom = mulberry32(SEED + 26)
const span = (low, high) => low + (high - low) * recordRandom()
const MINUTE = 60 * 1000
const money = (value) => Math.round(value * 100) / 100

// How long each customer takes to send back its translated designs, as a share
// of the usual labeling time: some customers are quick, some slow. A slow one
// makes the whole labeling longer, since the labels can't be printed and applied
// before its design is in.
const DESIGN_SHARE = [0.25, 0.55]
const USUAL_DESIGN_SHARE = (DESIGN_SHARE[0] + DESIGN_SHARE[1]) / 2
for (const customer of MADE_UP) customer.designShare = span(DESIGN_SHARE[0], DESIGN_SHARE[1])


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
for (const customer of MADE_UP) customer.usual = shuffle(PRODUCTS).slice(0, whole(4, 7))


// One order placed at a time: its container and its lines, mostly the
// customer's usual products and now and then a new one, filling the container.
// About a third fill a 40-ft, more of them in the busy months (bigContainerShare,
// below) ---------------------------------------------------------------------------

function planOrder(customer, time) {
  const size = chance(bigContainerShare(time)) ? (chance(0.25) ? '40-ft HC' : '40-ft') : '20-ft'
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

function labelingDays(kind, lines, customer) {
  const days = LABELING_DAYS[kind] + 0.4 * (lines.length - 3)
  const pace = 1 - USUAL_DESIGN_SHARE + customer.designShare
  return Math.max(2, days * pace * Math.max(0.6, 1 + 0.15 * normal()))
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
    const ready = officeTime(warehouse + labelingDays(kind, lines, customer) * DAY)
    const shipped = officeTime(ready + between(0.2, 1.6) * DAY)

    if (shipped < NOW - 0.5 * DAY || attempt > 20) {
      const tight = chance(0.15)
      return {
        customer,
        size,
        lines,
        kind,
        status: 'shipped',
        times: { 'pending payment': t0, submitted, 'payment verified': verified, procurement: ordered, 'warehouse preparation': warehouse, 'ready for shipment': ready, shipped },
        po,
        requested: addDays(dayOf(t0), tight ? whole(35, 45) : whole(60, 95)),
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
  { status: 'submitted', age: 3.4 },                                       // stuck in the payment check
  { status: 'payment verified', age: 11 },                                 // the POs are late going out
  { status: 'procurement', age: 6 },
  { status: 'procurement', age: 24, overdue: true },                       // a delivery is overdue
  { status: 'warehouse preparation', age: 2, labels: 'original label received' },
  { status: 'warehouse preparation', age: 30, tight: true, labels: 'awaiting customer translated design' }, // labeling is taking long
  { status: 'ready for shipment', age: 0.4 },
]

const STEPS = ['pending payment', 'submitted', 'payment verified', 'procurement', 'warehouse preparation', 'ready for shipment', 'shipped']

// About how many days before today an order now in each step was placed, and
// how long an order usually takes from placed to its PO.
const USUAL_DAYS_BEFORE = { 'pending payment': 0, submitted: 2.2, 'payment verified': 3.4, procurement: 9.9, 'warehouse preparation': 38, 'ready for shipment': 48 }
const USUAL_DAYS_TO_PO = 9.9

// Worked out backwards from when it entered its current step, to start as near
// as it can to plan.placedAt, where its customer's pace puts it.
function activeOrder(plan) {
  const { customer, size, lines, kind } = plan
  const step = STEPS.indexOf(plan.status)
  const entered = NOW - plan.age * DAY
  const times = { [plan.status]: entered }
  let po = null

  if (step >= 4) {
    // In the warehouse: every supplier delivered before it got there. Of a few
    // tries, the labeling time and PO that start the order nearest that day.
    let ordered = null
    for (let attempt = 0, nearest = Infinity; attempt < 24; attempt++) {
      const warehouse = step === 4 ? entered : entered - labelingDays(kind, lines, customer) * DAY
      let sent = officeTime(warehouse - 35 * DAY)
      const tried = deliveries(lines, sent)

      // Move the whole PO (sent, promised, delivered) by whole days, so the last
      // delivery comes just before the warehouse step.
      const lastArrival = Math.max(...tried.parts.map((part) => part.receivedAt))
      const shiftDays = Math.round((lastArrival - (warehouse - between(0.05, 0.25) * DAY)) / DAY)
      sent -= shiftDays * DAY
      tried.promised = addDays(tried.promised, -shiftDays)
      tried.parts.forEach((part) => {
        part.receivedAt -= shiftDays * DAY
        part.paidOn = addDays(part.paidOn, -shiftDays)
      })

      const off = Math.abs(sent - USUAL_DAYS_TO_PO * DAY - plan.placedAt)
      if (off < nearest) {
        nearest = off
        ordered = sent
        po = tried
      }
    }

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

  // The earlier steps, backwards: each as long as it needs to be for the order
  // to start on that day, within the time that step can take.
  const first = Math.min(...Object.values(times))
  const before = STEPS.slice(0, STEPS.indexOf(Object.keys(times).find((key) => times[key] === first)))
  const ranges = before.map((earlier) => ({ 'pending payment': [0.3, 6], submitted: [0.6, 1.8], 'payment verified': [4.5, 8.5] }[earlier]))
  const shortest = ranges.reduce((sum, [low]) => sum + low, 0)
  const longest = ranges.reduce((sum, [, high]) => sum + high, 0)
  const share = before.length ? Math.max(0, Math.min(1, ((first - plan.placedAt) / DAY - shortest) / (longest - shortest))) : 0
  let time = first
  for (let index = before.length - 1; index >= 0; index--) {
    const [low, high] = ranges[index]
    time -= (low + (high - low) * share) * DAY
    times[before[index]] = time
  }

  return {
    customer,
    size,
    lines,
    kind,
    status: plan.status,
    times,
    po,
    requested: addDays(dayOf(times['pending payment']), plan.tight ? whole(30, 40) : whole(60, 95)),
    labels: plan.labels || (step >= 5 ? 'applied to units' : null),
  }
}


// A routine order still under way: taken forward from the day it was placed,
// like a finished one, and stopped at today. Null when it can't be one (placed
// only hours ago, or it would have shipped by now however it went).
function routineOrder(plan) {
  const { customer, size, lines, kind } = plan
  const t0 = officeTime(plan.placedAt)
  if (t0 > NOW - 0.2 * DAY) return null

  for (let attempt = 0; attempt < 60; attempt++) {
    const submitted = t0 + between(0.3, 6) * DAY
    const verified = officeTime(submitted + between(0.6, 1.8) * DAY)
    const ordered = officeTime(verified + between(4.5, 8.5) * DAY)
    const po = deliveries(lines, ordered)
    const lastArrival = Math.max(...po.parts.map((part) => part.receivedAt))
    const warehouse = lastArrival + between(0.05, 0.25) * DAY
    const ready = officeTime(warehouse + labelingDays(kind, lines, customer) * DAY)
    const shipped = officeTime(ready + between(0.2, 1.6) * DAY)

    // It would have shipped by now, or its last delivery only just came in: again.
    if (shipped <= NOW || (lastArrival <= NOW && warehouse > NOW)) continue

    const reached = Object.entries({ 'pending payment': t0, submitted, 'payment verified': verified, procurement: ordered, 'warehouse preparation': warehouse, 'ready for shipment': ready })
      .filter(([, time]) => time <= NOW)

    return {
      customer,
      size,
      lines,
      kind,
      status: reached.at(-1)[0],
      times: Object.fromEntries(reached),
      po: ordered <= NOW ? po : null,
      requested: addDays(dayOf(t0), chance(0.15) ? whole(35, 45) : whole(60, 95)),
      // Its labels are wherever their steps have got to by today (below).
      labels: ready <= NOW ? 'applied to units' : null,
      labelsDoneAt: ready,
    }
  }

  return null
}


// Every order --------------------------------------------------------------------

const orders = []

if (MADE_UP.reduce((sum, customer) => sum + customer.finished, 0) !== FINISHED_ORDERS) {
  throw new Error(`Expected ${FINISHED_ORDERS} finished orders`)
}

// More is ordered in the months before Christmas and less over the holidays
// (made up, like everything here), for the demand forecast to find: each
// month's cases against an ordinary month's. Part of it shows in how often
// customers order (SEASON_IN_PACE), the rest in how big their orders are.
const ORDER_SEASON = { 1: 0.8, 2: 0.85, 3: 0.9, 4: 0.95, 5: 1, 6: 1, 7: 1.1, 8: 1.3, 9: 1.5, 10: 1.5, 11: 1.2, 12: 0.7 }
const SEASON_IN_PACE = 0.4

// The share of orders that fill a 40-ft container in the month of a time: 32%
// in an ordinary month, from about 1 in 10 over the holidays to 2 in 3 at the
// peak, so an order's cases follow the rest of the season. (A 20-ft order has
// about 1,150 cases and a 40-ft about 2,525.)
function bigContainerShare(time) {
  const cases = 1590 * Math.pow(ORDER_SEASON[monthOf(time)], 1 - SEASON_IN_PACE)
  return Math.max(0.05, Math.min(0.75, (cases - 1150) / 1375))
}

// Finished orders start up to about two months back, so orders ship in every
// month up to now. The months since are filled by the orders still under way.
const lastStart = NOW - 75 * DAY

// Each customer reorders at its own pace, for the next-order prediction to
// find: its orders come evenly spaced, give or take a few days. The spacing is
// counted in season days (a day in a busy month counts for a little more), so
// every customer orders a little sooner before Christmas and later over the
// holidays.
const seasonDaysBy = [0]   // season days from the start to each day after it
for (let time = START; time < NOW; time += DAY) seasonDaysBy.push(seasonDaysBy.at(-1) + Math.pow(ORDER_SEASON[monthOf(time)], SEASON_IN_PACE))

const seasonDayOf = (time) => {
  const days = Math.max(0, (time - START) / DAY)
  const index = Math.min(Math.floor(days), seasonDaysBy.length - 2)
  return seasonDaysBy[index] + (days - index) * (seasonDaysBy[index + 1] - seasonDaysBy[index])
}
// Null once it's past today.
const timeOfSeasonDay = (position) => {
  const index = seasonDaysBy.findIndex((value) => value > position) - 1
  if (index < 0) return null
  return START + (index + (position - seasonDaysBy[index]) / (seasonDaysBy[index + 1] - seasonDaysBy[index])) * DAY
}

// When a customer places its orders: its finished ones first (customer.finished
// of them, up to lastStart), then on at the same pace up to today.
function orderTimes(customer) {
  const spacing = seasonDayOf(lastStart) / customer.finished
  const phase = between(0.3, 0.9)
  const times = []
  for (let index = 0; ; index++) {
    const nudge = Math.max(-0.2, Math.min(0.2, 0.08 * normal()))
    const time = timeOfSeasonDay(spacing * (index + phase + nudge))
    if (time === null || time > NOW - 0.6 * DAY) return times
    times.push(time)
  }
}

const orderTimesOf = new Map(MADE_UP.map((customer) => [customer.key, orderTimes(customer)]))

// The finished orders, then their products in the order each customer placed
// them, so each order knows whether it's new to its customer.
const plans = MADE_UP
  .flatMap((customer) => orderTimesOf.get(customer.key).slice(0, customer.finished).map((createdAt) => ({ customer, createdAt })))
  .sort((a, b) => a.createdAt - b.createdAt)
if (plans.length !== FINISHED_ORDERS) throw new Error(`Expected ${FINISHED_ORDERS} finished orders, planned ${plans.length}`)

const orderedBy = new Map()
const productsOrdered = (customer) => {
  if (!orderedBy.has(customer.key)) orderedBy.set(customer.key, new Set())
  return orderedBy.get(customer.key)
}

for (const plan of plans) {
  Object.assign(plan, planOrder(plan.customer, plan.createdAt))
  const ordered = productsOrdered(plan.customer)
  plan.kind = kindOf(plan, ordered)
  plan.lines.forEach((line) => ordered.add(line.key))
  orders.push(finishedOrder(plan))
}

// The orders under way: where the made-up customers' paces put them since
// lastStart. The system's own customer accounts get none, so they keep their
// real balances. Each order of the list above takes the place nearest to when
// it would have been placed (the early steps first: their day is the most
// fixed); the rest are routine orders.
const places = MADE_UP.flatMap((customer) => orderTimesOf.get(customer.key).slice(customer.finished).map((createdAt) => ({ customer, createdAt })))
const underWay = []

for (const scenario of [...ACTIVE].sort((a, b) => STEPS.indexOf(a.status) - STEPS.indexOf(b.status) || a.age - b.age)) {
  if (!places.length) throw new Error('Too few orders under way for the list of orders at risk')
  const target = NOW - (scenario.age + USUAL_DAYS_BEFORE[scenario.status]) * DAY
  const place = places.reduce((best, candidate) => (Math.abs(candidate.createdAt - target) < Math.abs(best.createdAt - target) ? candidate : best))
  places.splice(places.indexOf(place), 1)
  underWay.push({ ...scenario, customer: place.customer, placedAt: place.createdAt })
}
for (const place of places) underWay.push({ customer: place.customer, placedAt: place.createdAt })

// The older ones first, for each customer's products.
underWay.sort((a, b) => a.placedAt - b.placedAt).forEach((plan) => {
  Object.assign(plan, planOrder(plan.customer, plan.placedAt))
  const ordered = productsOrdered(plan.customer)
  plan.kind = kindOf(plan, ordered)
  plan.lines.forEach((line) => ordered.add(line.key))
  const order = plan.status ? activeOrder(plan) : routineOrder(plan)
  if (order) orders.push(order)
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

      const ready = officeTime(order.times['warehouse preparation'] + labelingDays(kind, order.lines, order.customer) * DAY)
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


// Each label's steps and every payment, with their times (db/migrations/026) ------
// They have random numbers of their own (recordRandom, above).

const LABEL_STEPS = [
  { status: 'original label received', by: 'warehouse' },           // the warehouse photographs the original label
  { status: 'awaiting customer translated design', by: 'sales' },   // sales sends it to the customer
  { status: 'customer design label received', by: 'customer' },     // the customer sends back its design
  { status: 'printed & awaiting application', by: 'sales' },        // sales checks and prints it
  { status: 'applied to units', by: 'warehouse' },                  // the warehouse applies it
]

// The steps an order's labels have been through by today, each with its time.
// A finished order's steps fill its labeling time; one under way has the steps
// reached so far.
function labelSteps(order) {
  const start = order.times['warehouse preparation']
  if (start === undefined) return []

  const end = order.times['ready for shipment'] ?? order.labelsDoneAt
  let times

  if (end !== undefined) {
    // The labeling without the customer's part, which every customer's order
    // of this kind takes; the customer's design takes its own share of it.
    const usual = (end - start) / (1 - USUAL_DESIGN_SHARE + order.customer.designShare)
    const received = start + span(0.02, 0.06) * usual
    const forwarded = received + span(0.03, 0.08) * usual
    const designed = forwarded + order.customer.designShare * span(0.85, 1.15) * usual
    const printed = designed + span(0.08, 0.15) * usual
    times = [received, forwarded, designed, printed, end - span(0.01, 0.04) * usual]
  } else {
    // Stopped at a step (the orders at risk): the steps up to it, within the
    // time it has been in the warehouse.
    const reached = LABEL_STEPS.findIndex((step) => step.status === order.labels)
    const gaps = [span(0.1, 0.4), span(0.1, 0.8), order.customer.designShare * span(8, 12), span(0.3, 1.5)].slice(0, reached + 1)
    const fit = Math.min(1, (0.9 * (NOW - start)) / DAY / gaps.reduce((sum, gap) => sum + gap, 0))
    let time = start
    times = gaps.map((gap) => (time += gap * fit * DAY))
  }

  // Staff work in office hours, where that keeps the steps in order.
  times = times.map((time, index) => {
    if (LABEL_STEPS[index].by === 'customer') return time
    const moved = officeTime(time, span)
    const next = times[index + 1] ?? end ?? NOW
    return moved < next - 15 * MINUTE ? moved : time
  })

  // The last label applied makes the order ready for shipment, so one still in
  // the warehouse hasn't had its labels applied yet.
  const ready = order.times['ready for shipment'] !== undefined

  return LABEL_STEPS
    .map((step, index) => ({ ...step, at: times[index] }))
    .filter((step, index) => step.at !== undefined && step.at <= NOW - 15 * MINUTE && (ready || index < LABEL_STEPS.length - 1))
}

// Every payment of an order by today: the down payment sent and verified, then
// the balance, which a customer pays in the days before its container ships.
function paymentsOf(order, { downPayment, total, settled }) {
  const { submitted, 'payment verified': verified, 'ready for shipment': ready, shipped } = order.times
  const list = []

  if (submitted !== undefined) {
    list.push({ event: 'payment sent', by: 'customer', at: submitted, amount: downPayment, details: { first: true, in_full: false } })
  }
  if (verified !== undefined) {
    list.push({ event: 'payment verified', by: 'sales', at: verified, amount: downPayment, details: { first: true, paid_so_far: downPayment, fully_paid: false } })
  }

  if (settled >= total && verified !== undefined && ready !== undefined) {
    const latest = (shipped ?? NOW) - 0.15 * DAY
    const sent = Math.min(latest - 0.1 * DAY, Math.max(verified + DAY, ready - span(0.3, 3) * DAY))
    const checked = officeTime(sent + span(0.05, 0.6) * DAY, span)
    const balance = money(total - downPayment)
    list.push({ event: 'payment sent', by: 'customer', at: sent, amount: balance, details: { first: false, in_full: true } })
    list.push({ event: 'payment verified', by: 'sales', at: checked < latest ? checked : (sent + latest) / 2, amount: balance, details: { first: false, paid_so_far: total, fully_paid: true } })
  }

  return list
}


// Numbers, totals and rows --------------------------------------------------------

const counters = {}
const nextNumber = (prefix, time) => {
  const year = dayOf(time).slice(0, 4)
  const key = `${prefix}-${year}`
  counters[key] = (counters[key] || 0) + 1
  return `SIM-${prefix}-${year}-${String(counters[key]).padStart(4, '0')}`
}

const rows = { orders: [], items: [], pos: [], poLines: [], labels: [] }

// counts: how many status changes, label steps and payments the rows hold.
const counts = { history: 0, labelSteps: 0, payments: 0 }

for (const order of orders) {
  order.id = uuid()
  const created = order.times['pending payment']
  order.number = nextNumber('ORD', created)

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

  // Its payments: the down payment is sent and verified as it's submitted and
  // verified (its steps), so only the balance needs its own times.
  const payments = paymentsOf(order, { downPayment, total, settled })
  const balance = payments.filter((payment) => !payment.details.first)
  counts.payments += payments.length
  counts.history += STEPS.filter((status) => order.times[status] !== undefined).length

  rows.orders.push({
    id: order.id,
    customerKey: order.customer.key,
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
    requested: order.requested,
    arrival: order.status === 'shipped' ? arrivalOf(order) : null,
    // When it reached each step (empty for the ones still ahead).
    times: STEPS.map((status) => order.times[status] ?? null),
    balanceSent: balance.find((payment) => payment.event === 'payment sent')?.at ?? null,
    balanceVerified: balance.find((payment) => payment.event === 'payment verified')?.at ?? null,
  })

  for (const line of order.lines) {
    rows.items.push({ id: line.id, orderId: order.id, supplierSlot: line.supplier.slot, productSlot: line.productSlot, quantity: line.quantity, price: line.price, subtotal: money(line.quantity * line.price) })
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
      // Paid a day to three after the PO, and by yesterday at the latest.
      const paidOn = paid || isIn ? (part.paidOn < TODAY ? part.paidOn : addDays(TODAY, -1)) : null

      // A line's amounts, status and the rest follow from these (see the SQL).
      for (const line of part.lines) {
        rows.poLines.push({ poId, supplierSlot: line.supplier.slot, productSlot: line.productSlot, ordered: line.quantity, cost: line.cost, paidOn, receivedAt: isIn ? part.receivedAt : null })
      }
    }
  }

  // Its labels, once the goods are in the warehouse: one for each product, a
  // few minutes apart, each with the time of every step it has been through.
  const steps = labelSteps(order)
  if (steps.length) {
    for (const line of order.lines) {
      const later = span(0, 10) * MINUTE
      rows.labels.push({ itemId: line.id, times: LABEL_STEPS.map((step, index) => (steps[index] ? steps[index].at + later : null)) })
      counts.labelSteps += steps.length
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
// A moment, to the second.
const stamp = (time) => (time === null || time === undefined ? 'null' : text(`${new Date(Math.round(time / 1000) * 1000).toISOString().slice(0, 19)}Z`))
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

// The same, into a temporary table that lasts until the script ends: the first
// rows make it, the rest are added.
function valuesTable(name, select, columns, list, render, footer = '') {
  if (!list.length) throw new Error(`Nothing to put in ${name}`)
  return valuesInsert(`create temp table ${name} on commit drop as\n${select}`, columns, list.slice(0, 400), render, footer)
    + (list.length > 400 ? `\n${valuesInsert(`insert into ${name}\n${select}`, columns, list.slice(400), render, footer)}` : '')
}

const finished = orders.filter((order) => order.status === 'shipped').length
const deliveryCount = rows.pos.reduce((sum, po) => sum + new Set(rows.poLines.filter((line) => line.poId === po.id).map((line) => line.supplierSlot)).size, 0)
const arrivals = rows.orders.filter((row) => row.arrival).length

const sql = `-- =============================================================================
-- Simulated history: ${HISTORY_MONTHS} months of made-up orders, for the predictions
-- =============================================================================
-- Made by db/demo/generate-simulated-history.mjs (seed ${SEED}) on ${TODAY}.
-- Run it once in the Supabase SQL editor (project scotywfepxfispgpauwm), after
-- db/migrations/026. It's all or nothing: if any line fails, nothing is added.
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
--   every status change, payment and label step, with its date and time
-- Its times follow DMC staff's usual times; see the generator for how.
--
-- Marked: order numbers SIM-ORD-…, PO numbers SIM-PO-…, companies "(simulated)",
-- emails @simulated.example.com. To take it all out:
-- db/demo/remove_simulated_history.sql.
-- =============================================================================

begin;


-- Once only, and after the scripts it needs ------------------------------------
do $$
begin
  if exists (select 1 from public.customer_orders where order_number like 'SIM-ORD-%') then
    raise exception 'The simulated history is already in. To load it again, run db/demo/remove_simulated_history.sql first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_orders' and column_name = 'arrived_on'
  ) then
    raise exception 'Run db/migrations/025 (recording container arrivals) first.';
  end if;

  if to_regclass('public.label_exchange_history') is null or to_regclass('public.customer_order_payment_history') is null then
    raise exception 'Run db/migrations/026 (payment and label history) first.';
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

-- Who each order belongs to: the made-up customers only. The system's own
-- customer accounts get none of it.
create temp table sim_customer (key text primary key, id uuid not null, location_id uuid) on commit drop;

insert into sim_customer (key, id, location_id)
values
${MADE_UP.map((customer) => `  (${text(customer.key)}, ${text(customer.id)}, ${text(customer.locationId)})`).join(',\n')};


-- Orders -----------------------------------------------------------------------------
-- One row an order: what it is, when it reached each step (empty for the steps
-- still ahead) and when its balance was sent and verified. The order, its
-- status changes and its payments are all made from it.
${valuesTable(
  'sim_order',
  `select v.id::uuid as id, v.customer_key, v.order_number, v.subtotal::numeric as subtotal, v.shipping::numeric as shipping, v.container_size, v.container_cost::numeric as container_cost,
       v.total::numeric as total, v.down_payment::numeric as down_payment, v.settled::numeric as settled, v.pending::numeric as pending, v.status,
       v.requested::date as requested, v.arrived_on::date as arrived_on, v.arrival_recorded_at::timestamptz as arrival_recorded_at,
       v.placed::timestamptz as placed, v.submitted::timestamptz as submitted, v.verified::timestamptz as verified, v.procurement::timestamptz as procurement,
       v.warehouse::timestamptz as warehouse, v.ready::timestamptz as ready, v.shipped::timestamptz as shipped,
       v.balance_sent::timestamptz as balance_sent, v.balance_verified::timestamptz as balance_verified`,
  'id, customer_key, order_number, subtotal, shipping, container_size, container_cost, total, down_payment, settled, pending, status, requested, arrived_on, arrival_recorded_at, placed, submitted, verified, procurement, warehouse, ready, shipped, balance_sent, balance_verified',
  rows.orders,
  (row) => [text(row.id), text(row.customerKey), text(row.number), amount(row.subtotal), amount(row.shipping), text(row.containerSize), amount(row.containerCost), amount(row.total), amount(row.downPayment), amount(row.settled), amount(row.pending), text(row.status), text(row.requested), text(row.arrival?.day ?? null), row.arrival ? stamp(row.arrival.recordedAt) : 'null', ...row.times.map(stamp), stamp(row.balanceSent), stamp(row.balanceVerified)],
)}
insert into public.customer_orders (id, customer_id, delivery_location_id, quotation_number, order_number, subtotal, shipping_cost, container_size, container_cost, total_amount, down_payment_amount, settled_amount, pending_payment_amount, status, created_at, requested_ship_date, estimated_ship_date, arrived_on, arrival_recorded_at)
select o.id, c.id, c.location_id, replace(o.order_number, 'SIM-ORD-', 'SIM-QT-'), o.order_number, o.subtotal, o.shipping, o.container_size, o.container_cost, o.total, o.down_payment, o.settled, o.pending, o.status,
       o.placed, o.requested, (o.shipped at time zone 'Asia/Manila')::date, o.arrived_on, o.arrival_recorded_at
from sim_order o
join sim_customer c on c.key = o.customer_key;

-- Every status change: each step an order has reached, with its time ---------------------------
insert into public.customer_order_status_history (customer_order_id, previous_status, new_status, changed_at)
select o.id, s.previous, s.next, s.changed_at
from sim_order o
cross join lateral (values
  (null, 'pending payment', o.placed),
  ('pending payment', 'submitted', o.submitted),
  ('submitted', 'payment verified', o.verified),
  ('payment verified', 'procurement', o.procurement),
  ('procurement', 'warehouse preparation', o.warehouse),
  ('warehouse preparation', 'ready for shipment', o.ready),
  ('ready for shipment', 'shipped', o.shipped)
) as s(previous, next, changed_at)
where s.changed_at is not null;

-- Every payment (db/migrations/026): the down payment is sent as the order is
-- submitted and verified as its payment is verified; then the balance. Sent by
-- the customer, verified by sales (made-up ones).
insert into public.customer_order_payment_history (customer_order_id, event, amount, details, happened_at, done_by_role)
select o.id, p.event, p.amount, p.details || '{"simulated": true}'::jsonb, p.happened_at, p.done_by
from sim_order o
cross join lateral (values
  ('payment sent', o.down_payment, jsonb_build_object('first', true, 'in_full', false), o.submitted, 'customer'),
  ('payment verified', o.down_payment, jsonb_build_object('first', true, 'paid_so_far', o.down_payment, 'fully_paid', false), o.verified, 'sales'),
  ('payment sent', o.total - o.down_payment, jsonb_build_object('first', false, 'in_full', true), o.balance_sent, 'customer'),
  ('payment verified', o.total - o.down_payment, jsonb_build_object('first', false, 'paid_so_far', o.total, 'fully_paid', true), o.balance_verified, 'sales')
) as p(event, amount, details, happened_at, done_by)
where p.happened_at is not null;

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
-- Purchase orders ------------------------------------------------------------------------
${valuesInsert(
  `insert into public.purchase_orders (id, customer_order_id, po_number, status, created_at, updated_at, expected_delivery_date)
select v.id::uuid, v.order_id::uuid, v.po_number, v.status, v.created_at::timestamptz, v.updated_at::timestamptz, v.promised::date`,
  'id, order_id, po_number, status, created_at, updated_at, promised',
  rows.pos,
  (row) => [text(row.id), text(row.orderId), text(row.number), text(row.status), stamp(row.createdAt), stamp(row.updatedAt), text(row.promised)],
)}
-- Their lines: what each supplier was asked for, paid and delivered ----------------------------
-- A line received is fully delivered, in good condition, and paid in full the
-- day its supplier was paid; one not received yet is awaiting delivery once
-- paid, else just sent to the supplier.
${valuesInsert(
  `insert into public.purchase_order_items (purchase_order_id, product_id, supplier_id, ordered_quantity, received_quantity, unit_price, status, created_at, updated_at, supplier_pfi_amount, payment_amount, payment_date, received_condition, fully_received_at)
select po.id, p.id, p.supplier_id, v.ordered,
       case when v.received_at is null then 0 else v.ordered end,
       v.unit_price,
       case when v.received_at is not null then 'fully delivered' when v.paid_on is not null then 'awaiting delivery' else 'sent to supplier' end,
       po.created_at,
       coalesce(v.received_at::timestamptz, po.created_at),
       case when v.paid_on is null then 0 else round(v.ordered * v.unit_price, 2) end,
       case when v.paid_on is null then 0 else round(v.ordered * v.unit_price, 2) end,
       v.paid_on::date,
       case when v.received_at is not null then 'good' end,
       v.received_at::timestamptz`,
  'po_id, supplier_slot, product_slot, ordered, unit_price, paid_on, received_at',
  rows.poLines,
  (row) => [text(row.poId), row.supplierSlot, row.productSlot, row.ordered, amount(row.cost), text(row.paidOn), stamp(row.receivedAt)],
  `join public.purchase_orders po on po.id = v.po_id::uuid
join sim_slot s on s.sim_slot = v.supplier_slot
join sim_product p on p.supplier_slot = s.real_slot and p.slot = ((v.product_slot - 1) % p.in_supplier) + 1`,
)}
-- Compliance labels, and each one's steps (db/migrations/026) ------------------------------------
-- One row a label: its order line, and when it reached each step (empty for the
-- steps still ahead).
${valuesTable(
  'sim_label',
  'select v.item_id::uuid as item_id, s.step, s.status, s.done_by, s.happened_at::timestamptz as happened_at',
  'item_id, received, forwarded, designed, printed, applied',
  rows.labels,
  (row) => [text(row.itemId), ...row.times.map(stamp)],
  `cross join lateral (values
${LABEL_STEPS.map((step, index) => `  (${index + 1}, ${text(step.status)}, ${text(step.by)}, v.${['received', 'forwarded', 'designed', 'printed', 'applied'][index]})`).join(',\n')}
) as s(step, status, done_by, happened_at)
where s.happened_at is not null`,
)}
-- The database would save each new label's first step by itself; these have
-- their own steps, each with its time, so that's off while they go in.
alter table public.compliance_label_exchanges disable trigger compliance_label_exchanges_history;

insert into public.compliance_label_exchanges (customer_order_item_id, status, created_at, updated_at)
select l.item_id, (array_agg(l.status order by l.step desc))[1], min(l.happened_at), max(l.happened_at)
from sim_label l
group by l.item_id;

alter table public.compliance_label_exchanges enable trigger compliance_label_exchanges_history;

-- Each label's steps, with who did each: a made-up member of staff, or the customer.
insert into public.label_exchange_history (exchange_id, from_status, to_status, details, happened_at, done_by_role)
select e.id, lag(l.status) over (partition by l.item_id order by l.step), l.status, '{"simulated": true}'::jsonb, l.happened_at, l.done_by
from sim_label l
join public.compliance_label_exchanges e on e.customer_order_item_id = l.item_id;


-- The checks back on ----------------------------------------------------------------------------
alter table public.customer_orders enable trigger customer_orders_credit_limit;
alter table public.purchase_order_items enable trigger purchase_order_items_price_list;
alter table public.purchase_orders enable trigger purchase_orders_number;


-- The POs' dated history (db/migrations/023): each PO was saved as created when
-- it went in; this adds when each supplier was paid, each line received, and
-- each PO fully delivered.
do $$
begin
  if to_regprocedure('public.fill_purchase_order_history()') is not null then
    perform public.fill_purchase_order_history();
  end if;
end $$;


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
  if v_count <> ${counts.history} then raise exception 'Expected ${counts.history} status changes, made %.', v_count; end if;

  select count(*) into v_count from public.label_exchange_history h join public.compliance_label_exchanges e on e.id = h.exchange_id join public.customer_order_items i on i.id = e.customer_order_item_id join public.customer_orders o on o.id = i.customer_order_id where o.order_number like 'SIM-ORD-%';
  if v_count <> ${counts.labelSteps} then raise exception 'Expected ${counts.labelSteps} label steps, made %.', v_count; end if;

  select count(*) into v_count from public.customer_order_payment_history h join public.customer_orders o on o.id = h.customer_order_id where o.order_number like 'SIM-ORD-%';
  if v_count <> ${counts.payments} then raise exception 'Expected ${counts.payments} payments, made %.', v_count; end if;
end $$;


commit;


-- Check ------------------------------------------------------------------------------------
-- Expect: ${MADE_UP.length} made-up customers, ${finished} finished orders, ${orders.length - finished} under way, ${rows.pos.length} purchase
-- orders, ${deliveryCount} supplier deliveries (a few may merge if there are fewer than
-- ${SUPPLIER_SLOTS} manufacturers), ${counts.history} status changes, ${arrivals} recorded arrivals,
-- ${counts.labelSteps} label steps, ${counts.payments} payments.
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
select 'status changes', count(*) from public.customer_order_status_history h join public.customer_orders o on o.id = h.customer_order_id where o.order_number like 'SIM-ORD-%'
union all
select 'recorded arrivals', count(*) from public.customer_orders where order_number like 'SIM-ORD-%' and arrived_on is not null
union all
select 'label steps', count(*) from public.label_exchange_history h join public.compliance_label_exchanges e on e.id = h.exchange_id join public.customer_order_items i on i.id = e.customer_order_item_id join public.customer_orders o on o.id = i.customer_order_id where o.order_number like 'SIM-ORD-%'
union all
select 'payments', count(*) from public.customer_order_payment_history h join public.customer_orders o on o.id = h.customer_order_id where o.order_number like 'SIM-ORD-%';
`

fs.writeFileSync(OUTPUT, sql)

console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${Math.round(sql.length / 1024)} KB), ${dayOf(START)} to ${TODAY}:`)
console.log(`  ${MADE_UP.length} made-up customers, ${finished} finished orders, ${orders.length - finished} under way`)
console.log(`  ${rows.items.length} order lines, ${rows.pos.length} POs, ${rows.poLines.length} PO lines, ${deliveryCount} supplier deliveries, ${counts.history} status changes`)
console.log(`  ${rows.labels.length} labels with ${counts.labelSteps} steps, ${counts.payments} payments`)
console.log(`  Deliveries in: ${deliveryStats.count}, late: ${deliveryStats.late} (${Math.round((100 * deliveryStats.late) / deliveryStats.count)}%)`)
console.log(`  Finished orders by labeling kind: ${Object.entries(kindCounts).map(([kind, count]) => `${kind} ${count}`).join(', ')}; kinds changed by the final dates: ${kindMismatches}`)
console.log(`  Shipped by month: ${Object.entries(shippedByMonth).sort().map(([month, count]) => `${month} ${count}`).join(', ')}`)
const placedByMonth = {}
for (const order of orders) { const month = dayOf(order.times['pending payment']).slice(0, 7); placedByMonth[month] = (placedByMonth[month] || 0) + 1 }
console.log(`  Placed by month: ${Object.entries(placedByMonth).sort().map(([month, count]) => `${month} ${count}`).join(', ')}`)
console.log(`  Recorded arrivals: ${arrivals} of ${finished} shipped orders (the rest still at sea or not recorded yet)`)
// Each customer's pace: the days between its orders, as they came out.
console.log('  Days between each customer\'s orders (middle, then the latest six):')
for (const customer of MADE_UP) {
  const days = orders.filter((order) => order.customer === customer).map((order) => dayOf(order.times['pending payment'])).sort()
  const gaps = days.slice(1).map((day, index) => Math.round((Date.parse(day) - Date.parse(days[index])) / DAY))
  const middle = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  console.log(`    ${(customer.slug || customer.key).padEnd(14)} ${String(days.length).padStart(2)} orders, every ${String(middle).padStart(2)} days; latest: ${gaps.slice(-6).join(', ')}`)
}
console.log('  Supplier patterns (position: usual lead days, on-time share, late by):')
console.log(`  ${SUPPLIERS.map((supplier) => `${supplier.slot}: ${supplier.lead}d ${Math.round(supplier.onTime * 100)}% +${supplier.lateBy}d`).join(' · ')}`)
