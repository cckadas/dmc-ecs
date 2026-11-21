// =============================================================================
// Shipment predictions — the maths only
//
// An order's estimate adds up the time left in each step:
//
//   payment check → ordering from suppliers → supplier deliveries → labeling → shipping
//
// Every number is learned from the system's own records, and nothing else:
//   - each step's time, from finished orders' status history
//     (customer_order_status_history): the middle value, with the quicker and
//     slower quarters of past orders as the likely range
//   - each supplier's deliveries against the date its PO promised. A supplier
//     with few deliveries leans on every supplier's deliveries: its own n
//     deliveries count for n ÷ (n + 5), everyone's for the rest
//   - labeling by the kind of order (utils/labelingKind.js), leaning the same
//     way on every order's labeling while a kind has few. Once an order is in
//     labeling, by where its labels are, piece by piece; before that, moved by
//     how quickly its customer usually sends designs (utils/labelingSteps.js)
//   - busy months, found in the deliveries: a PO sent in a month whose
//     deliveries took longer than usual gets those extra days
//   - the sailing time to the customer's country, from recorded arrivals
// With fewer than MIN_RECORDS records for a step there's no estimate: the
// system says it's still learning instead of guessing. And nothing is learned
// from a test run, whatever went from start to finish in under a day
// (utils/testRuns.js).
//
// Out of it come the ready date (all labels applied), the ship date and, once
// arrivals to that part of the world are recorded, the arrival date.
//
// The website (services/predictionService.js) and DMC's server (estimates and
// the customer assistant) both use this file, so every screen and the chatbot
// give the same estimate. Its imports carry their .js extension for the server.
// =============================================================================

import { MIN_PO_DELIVERY_DAYS } from './dates.js'
import { TEST_RUN_DAYS, isTestRun } from './testRuns.js'
import { hasShipped, isRushStep, lastShipEntry } from './orderShipping.js'

export const ORDER_STATUS_FLOW = [
  'pending payment',
  'submitted',
  'payment verified',
  'procurement',
  'warehouse preparation',
  'ready for shipment',
]

// The steps an estimate adds up, and the status an order is in during each.
export const ESTIMATE_STEPS = [
  { key: 'payment_check', status: 'submitted', label: 'Payment check' },
  { key: 'ordering', status: 'payment verified', label: 'Ordering from suppliers' },
  { key: 'suppliers', status: 'procurement', label: 'Supplier deliveries' },
  { key: 'labeling', status: 'warehouse preparation', label: 'Labeling' },
  { key: 'shipping', status: 'ready for shipment', label: 'Shipping' },
]

export const RECORD_WEIGHT = 5          // a group's own records count for n ÷ (n + 5)
export const MIN_RECORDS = 3            // records a step needs before it's estimated
const MIN_PO_DAYS = MIN_PO_DELIVERY_DAYS // the shortest delivery a PO may ask for
const MAX_STEP_DAYS = 180               // longer is a mistake in the records

// The steps no real order gets through in under a day: its goods delivered,
// its labels made and applied. One that did was being tried out.
const NEVER_UNDER_A_DAY = new Set(['suppliers', 'labeling'])

export const normalizeStatus = (status) => (status || '').trim().toLowerCase()

const DAY = 1000 * 60 * 60 * 24
const STEP_BY_STATUS = Object.fromEntries(ESTIMATE_STEPS.map((step) => [step.status, step]))

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

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

const standardDeviation = (values) => {
  if (values.length < 2) return 0
  const avg = average(values)
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length)
}

const isDays = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))

const byTime = (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()

// A YYYY-MM-DD date as a moment: midday in the Philippines, so adding days
// never lands on the wrong date.
const dateToTime = (date) => Date.parse(`${date}T12:00:00+08:00`)

// The month (1-12) a moment falls in, in the Philippines.
const manilaMonth = (time) => new Date(time + 8 * 60 * 60 * 1000).getUTCMonth() + 1

// The share of a group's days that comes from its own records rather than the
// wider group's.
export const recordShare = (count) => count / (count + RECORD_WEIGHT)

// More records and steadier times = more confidence, from 40% to 95%.
function confidenceFor(values) {
  if (!values.length) return 40
  const avg = average(values)
  const sampleFactor = Math.min(values.length / 20, 1)
  const consistencyFactor = avg > 0 ? 1 / (1 + standardDeviation(values) / avg) : 1
  return Math.max(40, Math.min(Math.round(45 + 50 * sampleFactor * consistencyFactor), 95))
}

// Days from records: the middle value, with the quicker and slower quarters as
// the likely range. Null with fewer than MIN_RECORDS records.
export function spanOf(values = []) {
  if (values.length < MIN_RECORDS) return null

  return {
    typical: median(values),
    quick: percentile(values, 0.25),
    slow: percentile(values, 0.75),
    count: values.length,
    share: 1,
    confidence: confidenceFor(values),
  }
}

// A group's days from its own records, leaning on a wider group's records while
// its own are few: its n records count for n ÷ (n + 5), the wider group's for
// the rest. E.g. one supplier's deliveries and every supplier's, or one kind of
// order's labeling and every order's. Without a wider group, its own records
// alone. Null when there aren't MIN_RECORDS records to go by.
export function blendStep(own = [], wider = null) {
  const widerSpan = wider ? spanOf(wider) : null
  if (!widerSpan) return spanOf(own)
  if (!own.length) return { ...widerSpan, count: 0, share: 0 }

  const share = recordShare(own.length)
  const mix = (ownValue, widerValue) => share * ownValue + (1 - share) * widerValue

  return {
    typical: mix(median(own), widerSpan.typical),
    quick: mix(percentile(own, 0.25), widerSpan.quick),
    slow: mix(percentile(own, 0.75), widerSpan.slow),
    count: own.length,
    share,
    confidence: Math.round(mix(confidenceFor(own), widerSpan.confidence)),
  }
}

// How many days longer (or shorter) than usual things took in each month, found
// in the records: each month's middle value against all months', counting for
// n ÷ (n + 5) of the difference, so a month with few records barely moves.
// records: [{ month: 1-12, days }]. Returns { 1-12: days }.
export function monthEffects(records = []) {
  const effects = {}
  if (records.length < MIN_RECORDS) return effects

  const overall = median(records.map((record) => record.days))

  for (let month = 1; month <= 12; month++) {
    const values = records.filter((record) => record.month === month).map((record) => record.days)
    if (values.length) effects[month] = recordShare(values.length) * (median(values) - overall)
  }

  return effects
}

// What's left of a step the order is already in: how much longer past orders
// took once they'd been in it this long. Slower than all of them: a day more.
export function remainingOfStep(durations, elapsed) {
  const longer = durations.filter((days) => days > elapsed).map((days) => days - elapsed)
  if (!longer.length) return { typical: 1, quick: 1, slow: 2 }
  return { typical: median(longer), quick: percentile(longer, 0.25), slow: percentile(longer, 0.75) }
}

// A step's days moved by some days more (or fewer), never under half a day.
function shiftSpan(span, days) {
  const typical = Math.max(0.5, span.typical + days)
  return {
    ...span,
    typical,
    quick: Math.min(Math.max(0.3, span.quick + days), typical),
    slow: Math.max(typical, span.slow + days),
  }
}

const daysText = (days) => (days < 1 ? 'less than a day' : `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`)

// Staff words for where an order in labeling is (utils/labelingSteps.js
// labelingLeft): who it waits on, for how long, and how long that usually takes.
function describeLabelPiece(left, labelSteps) {
  const usual = left.usual?.typical
  const forCustomer = left.piece.key === 'design' && labelSteps.paceOrders > 0
  const usually = usual === undefined ? '' : forCustomer ? `; this customer usually takes about ${daysText(usual)}` : `; usually about ${daysText(usual)}`

  return {
    key: left.piece.key,
    waitingOn: left.piece.waitingOn,
    short: left.piece.waiting,
    daysIn: left.daysIn,
    usualDays: usual ?? null,
    text: `${left.piece.waiting} for ${daysText(left.daysIn)}${usually}`,
  }
}


// =============================================================================
// Learning from the records
// =============================================================================

// An order counts as finished once it was ready for shipment (or shipped).
// Its run: from when the work on it started (its payment verified, or its
// first status when that wasn't saved) to when it was ready. Null until then,
// and when nothing before that was saved, so how long it took isn't known.
// entries: its status changes.
export function orderRun(entries = []) {
  const sorted = [...entries].sort(byTime)
  const ready = sorted.find((entry) => ['ready for shipment', 'shipped', 'partly shipped'].includes(normalizeStatus(entry.new_status)))
  if (!ready) return null

  const readyAt = new Date(ready.changed_at).getTime()
  const verified = sorted.find((entry) => normalizeStatus(entry.new_status) === 'payment verified')
  const start = verified && new Date(verified.changed_at).getTime() <= readyAt ? verified : sorted[0]
  if (start === ready) return null

  return { startedAt: new Date(start.changed_at).getTime(), readyAt }
}

// One that got from its payment to ready in under a day is a test run, not a
// real export order (utils/testRuns.js): nothing is learned from its times.
export function isTestOrder(entries = []) {
  const run = orderRun(entries)
  return Boolean(run) && isTestRun(run.startedAt, run.readyAt)
}

// How long finished orders spent in each step, plus every order's history.
// labelingKindOf (optional): order id → its labeling kind (utils/labelingKind.js),
// to keep each kind's labeling times apart: labeling.byKind.
// tests: what wasn't learned from, as test runs: whole orders, and the supplier
// and labeling steps that other orders got through in under a day.
export function buildStageStatistics(allHistory, labelingKindOf = null) {
  const historyByOrder = {}
  allHistory.forEach((entry) => {
    if (!historyByOrder[entry.customer_order_id]) historyByOrder[entry.customer_order_id] = []
    historyByOrder[entry.customer_order_id].push(entry)
  })

  const durations = Object.fromEntries(ESTIMATE_STEPS.map((step) => [step.key, []]))
  const labelingByKind = labelingKindOf ? { regular: [], big: [], new: [] } : null
  let finishedOrders = 0
  const tests = { orders: 0, suppliers: 0, labeling: 0 }

  Object.entries(historyByOrder).forEach(([orderId, entries]) => {
    const sorted = [...entries].sort(byTime)
    const run = orderRun(sorted)
    if (!run) return
    if (isTestRun(run.startedAt, run.readyAt)) {
      tests.orders++
      return
    }
    finishedOrders++
    const kind = labelingKindOf ? labelingKindOf(orderId) : null

    // Time spent in a step = from entering its status until the next change.
    for (let i = 0; i < sorted.length - 1; i++) {
      const step = STEP_BY_STATUS[normalizeStatus(sorted[i].new_status)]
      if (!step) continue

      // A rush shipment ended its supplier step by the customer's choice, not
      // because every delivery came (db/migrations/034).
      if (isRushStep(sorted[i + 1])) continue

      const days = (new Date(sorted[i + 1].changed_at) - new Date(sorted[i].changed_at)) / DAY
      if (days < 0 || days > MAX_STEP_DAYS) continue
      // Its goods in, or its labels done, in under a day: that step was tried out.
      if (NEVER_UNDER_A_DAY.has(step.key) && days < TEST_RUN_DAYS) {
        tests[step.key]++
        continue
      }

      durations[step.key].push(days)
      if (step.key === 'labeling' && labelingByKind?.[kind]) labelingByKind[kind].push(days)
    }
  })

  const stageStatistics = Object.fromEntries(ESTIMATE_STEPS.map((step) => {
    const values = durations[step.key]
    return [step.key, {
      durations: values,
      median: median(values),
      p25: percentile(values, 0.25),
      p75: percentile(values, 0.75),
      sampleCount: values.length,
      confidence: confidenceFor(values),
      ...(step.key === 'labeling' && labelingByKind ? { byKind: labelingByKind } : {}),
    }]
  }))

  return { stageStatistics, historyByOrder, finishedOrders, tests }
}


// =============================================================================
// Suppliers
// =============================================================================

// The chance a supplier's delivery comes late: the share of its own deliveries
// that came late, leaning on every supplier's share while it has few.
// pool: every supplier's deliveries (utils/estimateInputs.js's supplierPool).
export function lateChanceOf(supplier, pool = {}) {
  const lateShare = (values) => values.filter((days) => days > 0).length / values.length
  const own = (supplier.history?.lateness || []).filter(isDays)
  const all = (pool.lateness || []).filter(isDays)

  if (!own.length) return all.length ? lateShare(all) : 0
  if (!all.length) return lateShare(own)

  const share = recordShare(own.length)
  return share * lateShare(own) + (1 - share) * lateShare(all)
}

// A supplier's past days (to deliver, or late) as weighted samples: its own
// records for n ÷ (n + 5), every supplier's for the rest, as blendStep weighs
// them. Null when there aren't enough to go by.
function weightedSamples(own = [], wider = []) {
  const widerOk = wider.length >= MIN_RECORDS
  if (!widerOk) return own.length >= MIN_RECORDS ? own.map((days) => ({ days, weight: 1 / own.length })) : null
  if (!own.length) return wider.map((days) => ({ days, weight: 1 / wider.length }))

  const share = recordShare(own.length)
  return [
    ...own.map((days) => ({ days, weight: share / own.length })),
    ...wider.map((days) => ({ days, weight: (1 - share) / wider.length })),
  ]
}

// The day by which a share q of the weighted samples is in.
function weightedQuantile(samples, q) {
  const sorted = [...samples].sort((a, b) => a.days - b.days)
  let total = 0
  for (const sample of sorted) {
    total += sample.weight
    if (total >= q - 1e-9) return sample.days
  }
  return sorted.at(-1).days
}

// The same samples moved so their middle value is `middle` (the model's).
const recenter = (samples, middle) => {
  const shift = middle - weightedQuantile(samples, 0.5)
  return samples.map((sample) => ({ ...sample, days: sample.days + shift }))
}

// When every one of several deliveries is in: the day by which they've all
// arrived with chance q. Each delivery is weighted samples of days. The chance
// all are in by a day is each one's chance multiplied, so the more suppliers
// an order waits on, the likelier one of them is late: three suppliers each on
// time 4 times in 5 are all on time only about half the time (0.8 × 0.8 × 0.8).
export function quantileOfLatest(deliveries, q) {
  const prepared = deliveries.map((samples) => {
    const sorted = [...samples].sort((a, b) => a.days - b.days)
    let total = 0
    return sorted.map((sample) => ({ days: sample.days, upTo: (total += sample.weight) }))
  })
  const chanceBy = (rows, day) => {
    let chance = 0
    for (const row of rows) {
      if (row.days > day) break
      chance = row.upTo
    }
    return chance
  }
  const days = [...new Set(prepared.flatMap((rows) => rows.map((row) => row.days)))].sort((a, b) => a - b)

  for (const day of days) {
    if (prepared.reduce((chance, rows) => chance * chanceBy(rows, day), 1) >= q - 1e-9) return day
  }
  return days.at(-1)
}

// When the order's suppliers should all have delivered, in the typical, quick
// and slow cases, and which deliveries are already overdue. The order waits
// for all of them, so its date is when every delivery is likely in, worked out
// from each supplier's past deliveries (quantileOfLatest).
//
// suppliers: [{ supplierId, name, promised, receivedOn, orderedOn, cases, products,
//               history: { leadDays, lateness } }]
// A supplier with a promised date has its PO; one without is still to be ordered,
// starting when ordering from suppliers is done (laneStarts).
// pool:          every supplier's deliveries (estimateInputs' supplierPool): what
//                a supplier with few of its own leans on, and the busy months
// stepDurations: the supplier step's days from the status history, for
//                suppliers not ordered from yet when no supplier has deliveries
// model (optional): the saved supplier model, used only when it beat the
//   statistics (utils/predictionModel.js): days early or late, from the supplier,
//   the cases and products ordered from it, the month and the days it's given.
//   It moves the middle of a supplier's days; its past deliveries keep the spread.
// unknown: true when a supplier not ordered from yet has nothing to go by.
// details: each supplier's own date and what it was worked out from, for staff
// (the order's date is when all of them are in, which is later than each alone).
export function supplierArrivals(suppliers, laneStarts, now, pool = {}, stepDurations = [], model = null) {
  const overdue = []
  const confidences = []
  const details = []
  const effects = monthEffects(pool.leadByMonth || [])
  const start = laneStarts.typical
  const busyExtra = effects[manilaMonth(start)] || 0
  const allLateness = (pool.lateness || []).filter(isDays)
  const allLeads = pool.leadDays || []
  // Each delivery still to come, as weighted samples of days from the start.
  const waitingOn = []
  let usedModel = false
  let unknown = false
  let usedStepRecords = false

  // Whose records a supplier's days came from: its own for `share`, every
  // supplier's for the rest (as weightedSamples weighs them). Null with none.
  const leanOf = (own, wider) => (wider.length >= MIN_RECORDS
    ? { own: own.length, all: wider.length, share: own.length ? recordShare(own.length) : 0 }
    : own.length >= MIN_RECORDS ? { own: own.length, all: 0, share: 1 } : null)

  for (const supplier of suppliers) {
    const who = { supplierId: supplier.supplierId, name: supplier.name }

    if (supplier.receivedOn) {
      details.push({ ...who, state: 'received', receivedOn: supplier.receivedOn })
      continue
    }

    const history = supplier.history || { leadDays: [], lateness: [] }
    const lateness = (history.lateness || []).filter(isDays)
    const fromStart = (time) => (time - start) / DAY

    // The model's days early or late, for a PO sent at a time with so many days given.
    const byModel = (daysGiven, sentAt) => model.predict({
      supplierId: supplier.supplierId,
      cases: supplier.cases,
      products: supplier.products,
      daysGiven,
      month: manilaMonth(sentAt),
    })

    if (supplier.promised) {
      const promisedAt = dateToTime(supplier.promised)
      const overdueDays = (now - promisedAt) / DAY
      // Days overdue by the calendar in the Philippines: promised Nov 2, on
      // Nov 5 it's 3 days overdue, whatever the hour.
      const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const daysPastPromise = Math.round((Date.parse(today) - Date.parse(supplier.promised)) / DAY)

      if (daysPastPromise >= 1) {
        // Already late: how much longer deliveries that came at least this late
        // took. None that late on record: at least 1 more day.
        const remaining = (values) => values.filter((days) => days > overdueDays).map((days) => Math.max(days - overdueDays, 1))
        const lean = leanOf(remaining(lateness), remaining(allLateness))
        const samples = weightedSamples(remaining(lateness), remaining(allLateness)) || [{ days: 1, weight: 1 }]
        waitingOn.push(samples.map((sample) => ({ days: fromStart(now) + sample.days, weight: sample.weight })))
        overdue.push({ name: supplier.name, days: daysPastPromise })
        confidences.push(blendStep(lateness, allLateness)?.confidence ?? 40)
        const moreDays = weightedQuantile(samples, 0.5)
        details.push({ ...who, state: 'overdue', promised: supplier.promised, overdueDays: daysPastPromise, moreDays, expectedAt: now + moreDays * DAY, lean })
        continue
      }

      // Ordered: its promised day, moved by how early or late it has been. With
      // no deliveries anywhere yet: the promised day.
      const lean = leanOf(lateness, allLateness)
      let samples = weightedSamples(lateness, allLateness) || [{ days: 0, weight: 1 }]
      const byModelHere = Boolean(model && supplier.orderedOn)
      if (byModelHere) {
        const modelled = byModel(Math.round((Date.parse(supplier.promised) - Date.parse(supplier.orderedOn)) / DAY), dateToTime(supplier.orderedOn))
        samples = recenter(samples, modelled.typical)
        usedModel = true
      }

      waitingOn.push(samples.map((sample) => ({ days: fromStart(promisedAt) + sample.days, weight: sample.weight })))
      confidences.push(byModelHere ? model.confidence : blendStep(lateness, allLateness)?.confidence ?? 40)
      const usualLate = weightedQuantile(samples, 0.5)
      details.push({ ...who, state: 'ordered', promised: supplier.promised, usualLate, expectedAt: Math.max(promisedAt + usualLate * DAY, now), lean, model: byModelHere })
      continue
    }

    // Not ordered yet: its days from PO to delivery, plus the busy-month days
    // found in the deliveries for the month its PO goes out.
    let samples = weightedSamples(history.leadDays || [], allLeads)

    if (!samples) {
      // No supplier deliveries on record: the supplier step's own days from
      // finished orders, which already wait for each order's slowest supplier.
      if ((stepDurations || []).length < MIN_RECORDS) {
        unknown = true
        continue
      }
      if (!usedStepRecords) {
        waitingOn.push(stepDurations.map((days) => ({ days, weight: 1 / stepDurations.length })))
        confidences.push(confidenceFor(stepDurations))
        usedStepRecords = true
      }
      const stepDays = median(stepDurations)
      details.push({ ...who, state: 'not ordered', fromStep: true, usualDays: stepDays, expectedAt: Math.max(start + stepDays * DAY, now), records: stepDurations.length })
      continue
    }

    const lean = leanOf(history.leadDays || [], allLeads)
    const leadDays = weightedQuantile(samples, 0.5)
    samples = samples.map((sample) => ({ ...sample, days: Math.max(sample.days + busyExtra, 0) }))

    if (model) {
      // With the model: given what Add PO will suggest (its usual days, at
      // least the PO minimum), how early or late it should come.
      const daysGiven = Math.max(MIN_PO_DAYS, Math.ceil(weightedQuantile(samples, 0.5)))
      samples = recenter(samples, daysGiven + byModel(daysGiven, start).typical)
      usedModel = true
      confidences.push(model.confidence)
    } else {
      confidences.push(blendStep(history.leadDays || [], allLeads)?.confidence ?? 40)
    }

    waitingOn.push(samples)
    const usualDays = weightedQuantile(samples, 0.5)
    details.push({ ...who, state: 'not ordered', leadDays, busyExtra, month: manilaMonth(start), usualDays, expectedAt: Math.max(start + usualDays * DAY, now), lean, model: Boolean(model) })
  }

  // Nothing arrives before now, and the step can't end before it starts.
  const ends = { ...laneStarts }
  if (waitingOn.length) {
    ends.quick = Math.max(laneStarts.quick + Math.max(quantileOfLatest(waitingOn, 0.25), 0) * DAY, now)
    ends.typical = Math.max(laneStarts.typical + Math.max(quantileOfLatest(waitingOn, 0.5), 0) * DAY, now)
    ends.slow = Math.max(laneStarts.slow + Math.max(quantileOfLatest(waitingOn, 0.75), 0) * DAY, now)
  }

  return { ends, overdue, confidence: confidences.length ? Math.round(average(confidences)) : null, usedModel, unknown, details }
}


// =============================================================================
// One order's estimate
// =============================================================================

// order:   id, status, created_at, requested_ship_date (or preferred_ship_date)
// context: everything optional; without it the steps use the status history only.
//   suppliers     see supplierArrivals; without them the supplier step uses the
//                 records of the whole step
//   supplierPool  every supplier's deliveries (estimateInputs' supplierPool)
//   sailing       { typical, quick, slow, count, nearest } days at sea to the
//                 customer's country, from recorded arrivals; none, no arrival date
//   labelingKind  regular, big or new (utils/labelingKind.js); bigContainer: a 40-ft
//   labelSteps    from the labels' saved steps (utils/labelingSteps.js
//                 labelingContext): left(now) for an order in labeling, and
//                 designExtra, the days its customer's pace adds to labeling
//   cases, products, countryName  the order's size and country, for the labeling model
//   models        { supplier, labeling }: the saved models in use, if any
//   now           the moment to estimate from (default: now)
export function predictOrder(order, stageStatistics, historyByOrder, context = {}) {
  const now = context.now ? new Date(context.now).getTime() : Date.now()
  const currentStatus = normalizeStatus(order.status)
  const orderHistory = [...(historyByOrder[order.id] || [])].sort(byTime)
  const requestedShipDate = order.requested_ship_date || order.preferred_ship_date || null

  const lastChangeInto = (status) => {
    const entry = [...orderHistory].reverse().find((item) => normalizeStatus(item.new_status) === status)
    return entry ? new Date(entry.changed_at) : null
  }

  if (hasShipped(currentStatus)) {
    // At sea: arrived once its arrival is recorded (db/migrations/025); until
    // then, expected by the days at sea recorded arrivals took. Shipped in part
    // (a rush shipment) counts from the day its own container left.
    const shipEntry = lastShipEntry(orderHistory)
    const shippedOn = shipEntry ? new Date(shipEntry.changed_at) : null
    const arrivedOn = order.arrived_on || null
    const sailing = !arrivedOn && shippedOn && context.sailing?.typical >= 0 ? context.sailing : null
    const fromShip = (days) => new Date(shippedOn.getTime() + days * DAY)

    return {
      ...order,
      currentStatus,
      shipped: true,
      shippedOn,
      requestedShipDate,
      arrivedOn,
      arrivalRecordedAt: order.arrival_recorded_at || null,
      estimatedArrivalDate: sailing ? fromShip(sailing.typical) : null,
      arrivalRange: sailing ? { quick: fromShip(sailing.quick), slow: fromShip(sailing.slow) } : null,
      arrivalNearest: sailing?.nearest || null,
    }
  }

  // Cancelled (its down payment never came): nothing ahead to estimate, and
  // not "at risk" either.
  if (currentStatus === 'cancelled') {
    return {
      ...order, currentStatus, cancelled: true, estimatedReadyDate: null, estimatedShipDate: null, confidence: 0,
      risk: 'cancelled', riskReason: null, riskReasons: [], requestedShipDate,
    }
  }

  const ifPaidToday = currentStatus === 'pending payment' || currentStatus === 'payment rejected'
  const currentStep = STEP_BY_STATUS[currentStatus]

  if (!ifPaidToday && !currentStep) {
    return {
      ...order, currentStatus, estimatedReadyDate: null, estimatedShipDate: null, confidence: 0,
      risk: 'at risk', riskReason: 'Current order status is not part of the prediction workflow.',
      riskReasons: ['Current order status is not part of the prediction workflow.'], requestedShipDate,
    }
  }

  // The records each step goes by. Labeling: orders of the same kind, leaning
  // on every order's labeling while that kind has few.
  const labelingKind = context.labelingKind || null
  const allDurations = (key) => stageStatistics?.[key]?.durations || []
  const kindDurations = (key) => (key === 'labeling' && labelingKind ? stageStatistics?.labeling?.byKind?.[labelingKind] || null : null)
  const spanFor = (key) => (kindDurations(key) ? blendStep(kindDurations(key), allDurations(key)) : blendStep(allDurations(key)))

  // What's left of the step an order is in, leaning the same way: its own
  // kind's records for n ÷ (n + 5), every order's for the rest.
  const remainingFor = (key, elapsed) => {
    const fromAll = remainingOfStep(allDurations(key), elapsed)
    const own = kindDurations(key)
    if (!own?.length) return fromAll

    const fromOwn = remainingOfStep(own, elapsed)
    const share = recordShare(own.length)
    const mix = (field) => share * fromOwn[field] + (1 - share) * fromAll[field]
    return { typical: mix('typical'), quick: mix('quick'), slow: mix('slow') }
  }

  // When the order entered its current status (else when it was created).
  const enteredAt = (currentStep || ifPaidToday ? lastChangeInto(currentStatus) : null)
    || (order.created_at ? new Date(order.created_at) : new Date(now))
  const currentStageAge = Math.max(0, (now - enteredAt.getTime()) / DAY)

  const lanes = { typical: now, quick: now, slow: now }
  const reasons = []
  const stepsAhead = []
  const confidences = []
  let readyLanes = null
  let overdueSuppliers = []
  let stuckStep = null
  let learning = null
  // Which way each step was worked out, for staff.
  const methods = { suppliers: 'statistics', labeling: 'statistics' }
  const labelingModel = context.models?.labeling || null
  const labelSteps = context.labelSteps || null
  // Where an order in labeling is, piece by piece, for staff.
  let labelStep = null

  const firstStep = ifPaidToday ? 0 : ESTIMATE_STEPS.indexOf(currentStep)
  // How the date is worked out, step by step, for staff (it names suppliers).
  const working = []

  for (const step of ESTIMATE_STEPS.slice(firstStep)) {
    const isCurrent = step === currentStep
    const full = spanFor(step.key)
    const before = { ...lanes }
    // What this step went by, for the working.
    let basis

    if (step.key === 'suppliers' && context.suppliers?.length) {
      const { ends, overdue, confidence, usedModel, unknown, details } = supplierArrivals(context.suppliers, lanes, now, context.supplierPool || {}, allDurations(step.key), context.models?.supplier || null)
      if (unknown) {
        learning = { step: step.key, label: step.label, records: allDurations(step.key).length, needed: MIN_RECORDS }
        break
      }

      if (usedModel) methods.suppliers = 'model'
      lanes.typical = ends.typical
      lanes.quick = ends.quick
      lanes.slow = ends.slow
      overdueSuppliers = overdue
      overdue.forEach((supplier) => {
        reasons.push(`${supplier.name}'s delivery is ${supplier.days} ${supplier.days === 1 ? 'day' : 'days'} overdue.`)
      })
      if (confidence !== null) confidences.push(confidence)
      basis = { how: 'suppliers', suppliers: details, model: usedModel }
    } else {
      // Labeling, with the model: its days for this order's size, kind, country
      // and month, instead of everyone's usual days.
      let whole = full
      if (step.key === 'labeling' && labelingModel) {
        const predicted = labelingModel.predict({
          cases: Number(context.cases) || 0,
          products: Number(context.products) || 1,
          country: context.countryName,
          month: manilaMonth(lanes.typical),
          newLabels: labelingKind === 'new' ? 1 : 0,
          bigContainer: context.bigContainer ? 1 : 0,
        })
        const typical = Math.max(0.5, predicted.typical)
        whole = { typical, quick: Math.max(0.3, Math.min(predicted.quick, typical)), slow: Math.max(predicted.slow, typical), confidence: labelingModel.confidence }
        methods.labeling = 'model'
      }

      // Too few finished orders with this step: no estimate yet.
      if (!whole) {
        learning = { step: step.key, label: step.label, records: allDurations(step.key).length, needed: MIN_RECORDS }
        break
      }

      let span = !isCurrent ? whole
        : whole === full ? remainingFor(step.key, currentStageAge)
          : { typical: Math.max(whole.typical - currentStageAge, 1), quick: Math.max(whole.quick - currentStageAge, 0.5), slow: Math.max(whole.slow - currentStageAge, 2) }

      // The finished orders it went by: every one's, and for labeling its own
      // kind's (which count for `share`, every order's for the rest).
      const own = kindDurations(step.key)
      basis = {
        how: whole !== full ? 'model' : isCurrent ? 'remaining' : 'usual',
        records: allDurations(step.key).length,
        ...(own ? { kind: labelingKind, kindRecords: own.length, share: own.length ? recordShare(own.length) : 0 } : {}),
        ...(isCurrent ? { daysIn: currentStageAge, longer: allDurations(step.key).filter((days) => days > currentStageAge).length } : {}),
      }

      // Labeling from the labels' saved steps: an order in labeling goes by
      // where its labels are; any other is moved by how much quicker or slower
      // its customer usually sends designs.
      if (step.key === 'labeling' && labelSteps) {
        const left = isCurrent && labelSteps.left ? labelSteps.left(now) : null

        if (left) {
          span = { typical: left.typical, quick: left.quick, slow: left.slow }
          labelStep = describeLabelPiece(left, labelSteps)
          if (left.usual && left.daysIn > left.usual.slow) reasons.push(`${labelStep.text}.`)
          basis = { how: 'labels', kind: labelingKind, piece: left.piece.key, waiting: left.piece.waiting, daysIn: left.daysIn, pieces: left.pieces || [], paceOrders: labelSteps.paceOrders || 0 }
        } else if (labelSteps.designExtra) {
          const shifted = shiftSpan(span, labelSteps.designExtra)
          // The days its customer's pace really moved it by (never under half a day).
          basis = { ...basis, designExtra: shifted.typical - span.typical, paceOrders: labelSteps.paceOrders || 0 }
          span = shifted
        }
      }

      if (isCurrent && currentStageAge > whole.slow) {
        stuckStep = { key: step.key, label: step.label, days: Math.round(currentStageAge), usualDays: Math.round(whole.typical) }
        reasons.push(`In ${step.label.toLowerCase()} for ${stuckStep.days} days, usually ${stuckStep.usualDays}.`)
      }

      lanes.typical += span.typical * DAY
      lanes.quick += span.quick * DAY
      lanes.slow += span.slow * DAY
      confidences.push(whole.confidence)
    }

    stepsAhead.push({ key: step.key, label: step.label, expectedEnd: new Date(lanes.typical) })
    working.push({
      key: step.key,
      label: step.label,
      current: isCurrent,
      // What this step adds, in days: the typical, quick and slow cases.
      days: (lanes.typical - before.typical) / DAY,
      quick: (lanes.quick - before.quick) / DAY,
      slow: (lanes.slow - before.slow) / DAY,
      endsOn: new Date(lanes.typical),
      ...basis,
    })
    if (step.key === 'labeling') readyLanes = { ...lanes }
  }

  // Still learning: too few records for one of the steps ahead, so no dates.
  if (learning) {
    const text = `Still learning: ${learning.label.toLowerCase()} needs ${learning.needed} finished orders to estimate; there ${learning.records === 1 ? 'is' : 'are'} ${learning.records}.`
    return {
      ...order,
      currentStatus,
      ifPaidToday,
      estimatedReadyDate: null,
      estimatedShipDate: null,
      shipDateRange: null,
      estimatedArrivalDate: null,
      arrivalRange: null,
      requestedShipDate,
      daysPastRequested: null,
      confidence: 0,
      roughEstimate: true,
      risk: null,
      riskReason: text,
      riskReasons: [],
      learning: { ...learning, text },
      stuckStep: null,
      overdueSuppliers: [],
      methods,
      customerNote: null,
      stepsAhead: [],
      working: null,
      currentStageAge,
      expectedRemainingDays: null,
    }
  }

  // An order already ready for shipment was ready when it got there.
  const estimatedReadyDate = currentStatus === 'ready for shipment'
    ? enteredAt
    : new Date(readyLanes?.typical ?? lanes.typical)

  const estimatedShipDate = new Date(lanes.typical)
  const shipDateRange = { quick: new Date(lanes.quick), slow: new Date(lanes.slow) }

  // At sea: the days recorded arrivals took to this part of the world.
  const sailing = context.sailing || null
  const estimatedArrivalDate = sailing?.typical > 0 ? new Date(lanes.typical + sailing.typical * DAY) : null
  const arrivalRange = estimatedArrivalDate
    ? { quick: new Date(lanes.quick + sailing.quick * DAY), slow: new Date(lanes.slow + sailing.slow * DAY) }
    : null

  const confidence = confidences.length ? Math.round(average(confidences)) : 40

  // Compared with the date the customer asked for, by calendar day in the Philippines.
  let daysPastRequested = null
  if (requestedShipDate) {
    const shipDay = new Date(lanes.typical + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    daysPastRequested = Math.round((Date.parse(shipDay) - Date.parse(requestedShipDate)) / DAY)
    if (daysPastRequested > 0) {
      reasons.unshift(`May miss the requested ship date by ${daysPastRequested} ${daysPastRequested === 1 ? 'day' : 'days'}.`)
    }
  }

  const risk = reasons.length ? 'at risk' : 'on track'
  const roughEstimate = confidence < 60

  // What a customer is told: only how the estimate compares with the date they
  // asked for. Never why (a supplier, a slow step): that's for staff.
  let customerNote = null
  if (daysPastRequested > 0) customerNote = 'May be later than your requested date. DMC will contact you.'
  else if (requestedShipDate) customerNote = 'On track for your requested date.'

  return {
    ...order,
    currentStatus,
    ifPaidToday,
    estimatedReadyDate,
    estimatedShipDate,
    shipDateRange,
    estimatedArrivalDate,
    arrivalRange,
    arrivalNearest: estimatedArrivalDate ? sailing.nearest || null : null,
    requestedShipDate,
    daysPastRequested,
    confidence,
    roughEstimate,
    risk,
    riskReason: reasons[0] || (roughEstimate
      ? 'A rough estimate: there are few finished orders to learn from yet.'
      : 'Order is progressing within expectations.'),
    riskReasons: reasons,
    learning: null,
    // The same, as data, for the staff alerts (server/alerts.js).
    stuckStep,
    overdueSuppliers,
    methods,
    // Staff: where an order in labeling is (it names who it waits on).
    labelStep,
    // Staff: how the date is worked out, step by step (utils/estimateWorking.js
    // puts it in words). It names suppliers, so a customer never gets it.
    working: {
      from: new Date(now),
      ifPaidToday,
      steps: working,
      shipsOn: estimatedShipDate,
      range: shipDateRange,
      sailing: estimatedArrivalDate
        ? { days: sailing.typical, arrivals: sailing.count ?? null, nearest: sailing.nearest || null, nearestArrivals: sailing.nearestCount ?? null, country: context.countryName || null, arrivesOn: estimatedArrivalDate }
        : null,
    },
    customerNote,
    stepsAhead,
    currentStageAge,
    expectedRemainingDays: Math.max(0, (lanes.typical - now) / DAY),
  }
}
