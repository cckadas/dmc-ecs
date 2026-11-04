// =============================================================================
// Shipment predictions — the maths only
//
// An order's estimate adds up the time left in each step:
//
//   payment check → ordering from suppliers → supplier deliveries → labeling → shipping
//
// Each step's time is learned from finished orders' status history
// (customer_order_status_history), blended with DMC's starting values while the
// records are few: the records count for n ÷ (n + 5) of the time, n being the
// finished orders behind that step. The supplier step waits on the order's
// slowest supplier, from each supplier's own deliveries against the date its PO
// promised. The quick and slow cases use the faster and slower quarters of past
// orders, which gives the likely range.
//
// Out of it come the ready date (all labels applied), the ship date and, when
// the sailing time to the customer's country is set, the arrival date.
//
// No imports on purpose: the website (services/predictionService.js) and the
// server's customer assistant (server/chatbot) both use this file, so every
// screen and the chatbot give the same estimate.
// =============================================================================

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

// Placeholders, in days, until admin enters DMC's own numbers (Prediction
// settings, db/migrations/017). supplier_lead is for suppliers DMC gave no time for.
export const DEFAULT_STARTING_DAYS = {
  payment_check: 1,
  ordering: 2,
  supplier_lead: 14,
  labeling: 5,
  shipping: 4,
  labeling_per_1000_cases: 0,
}

// How often a supplier is late, as DMC staff put it, as a share of deliveries.
export const LATE_SHARES = { rarely: 0.1, sometimes: 0.3, often: 0.5 }

export const RECORD_WEIGHT = 5          // records count for n ÷ (n + 5)
const QUICK_SHARE = 0.8                 // a starting value's likely range:
const SLOW_SHARE = 1.3                  //   20% quicker to 30% slower
const MIN_FINISHED_DAYS = 1             // quicker "finished" orders are test runs
const MAX_STEP_DAYS = 180               // longer is a mistake in the records

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

const byTime = (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()

// A YYYY-MM-DD date as a moment: midday in the Philippines, so adding days
// never lands on the wrong date.
const dateToTime = (date) => Date.parse(`${date}T12:00:00+08:00`)

// The share of a step's time that comes from records rather than starting values.
export const recordShare = (count) => count / (count + RECORD_WEIGHT)

// More records and steadier times = more confidence, from 40% to 95%.
function confidenceFor(values) {
  if (!values.length) return 40
  const avg = average(values)
  const sampleFactor = Math.min(values.length / 20, 1)
  const consistencyFactor = avg > 0 ? 1 / (1 + standardDeviation(values) / avg) : 1
  return Math.max(40, Math.min(Math.round(45 + 50 * sampleFactor * consistencyFactor), 95))
}

// A step's typical, quick and slow days: the records' middle value and
// quarters, blended with a starting value. With no records, the starting value.
export function blendStep(durations, startingDays) {
  const share = recordShare(durations.length)
  const start = { typical: startingDays, quick: startingDays * QUICK_SHARE, slow: startingDays * SLOW_SHARE }

  if (!durations.length) return { ...start, count: 0, share: 0, confidence: 40 }

  return {
    typical: share * median(durations) + (1 - share) * start.typical,
    quick: share * percentile(durations, 0.25) + (1 - share) * start.quick,
    slow: share * percentile(durations, 0.75) + (1 - share) * start.slow,
    count: durations.length,
    share,
    confidence: confidenceFor(durations),
  }
}

// What's left of a step the order is already in. Past orders that had been in
// it at least as long show how much longer it takes; with none, 1 more day.
function remainingOfStep(span, durations, startingDays, elapsed) {
  const longer = durations.filter((days) => days > elapsed).map((days) => days - elapsed)
  const fromRecords = longer.length
    ? { typical: median(longer), quick: percentile(longer, 0.25), slow: percentile(longer, 0.75) }
    : { typical: 1, quick: 1, slow: 2 }
  const fromStart = {
    typical: Math.max(startingDays - elapsed, 1),
    quick: Math.max(startingDays * QUICK_SHARE - elapsed, 0.5),
    slow: Math.max(startingDays * SLOW_SHARE - elapsed, 2),
  }
  const share = span.share

  return {
    typical: share * fromRecords.typical + (1 - share) * fromStart.typical,
    quick: share * fromRecords.quick + (1 - share) * fromStart.quick,
    slow: share * fromRecords.slow + (1 - share) * fromStart.slow,
  }
}


// =============================================================================
// Learning from the records
// =============================================================================

// An order counts as finished once it was ready for shipment (or shipped).
// One that got there in under a day is a test run, not a real export order.
function finishedOrder(sorted) {
  const ready = sorted.find((entry) => ['ready for shipment', 'shipped'].includes(normalizeStatus(entry.new_status)))
  if (!ready || !sorted.length) return false
  return (new Date(ready.changed_at) - new Date(sorted[0].changed_at)) / DAY >= MIN_FINISHED_DAYS
}

// How long finished orders spent in each step, plus every order's history.
export function buildStageStatistics(allHistory) {
  const historyByOrder = {}
  allHistory.forEach((entry) => {
    if (!historyByOrder[entry.customer_order_id]) historyByOrder[entry.customer_order_id] = []
    historyByOrder[entry.customer_order_id].push(entry)
  })

  const durations = Object.fromEntries(ESTIMATE_STEPS.map((step) => [step.key, []]))
  let finishedOrders = 0

  Object.values(historyByOrder).forEach((entries) => {
    const sorted = [...entries].sort(byTime)
    if (!finishedOrder(sorted)) return
    finishedOrders++

    // Time spent in a step = from entering its status until the next change.
    for (let i = 0; i < sorted.length - 1; i++) {
      const step = STEP_BY_STATUS[normalizeStatus(sorted[i].new_status)]
      if (!step) continue

      const days = (new Date(sorted[i + 1].changed_at) - new Date(sorted[i].changed_at)) / DAY
      if (days < 0 || days > MAX_STEP_DAYS) continue

      durations[step.key].push(days)
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
    }]
  }))

  return { stageStatistics, historyByOrder, finishedOrders }
}


// =============================================================================
// Suppliers
// =============================================================================

// When each supplier the order still waits on should deliver, in the typical,
// quick and slow cases, and which deliveries are already overdue.
//
// suppliers: [{ name, promised, receivedOn, history: { leadDays, lateness },
//               starting: { usualLeadDays, lateFrequency, usualLateDays } }]
// A supplier with a promised date has its PO; one without is still to be ordered,
// starting when ordering from suppliers is done (laneStarts).
export function supplierArrivals(suppliers, laneStarts, now, starting, busyExtraFor) {
  const ends = { ...laneStarts }
  const overdue = []
  const confidences = []

  for (const supplier of suppliers) {
    if (supplier.receivedOn) continue

    const history = supplier.history || { leadDays: [], lateness: [] }
    const theirs = supplier.starting || {}
    let arrival

    if (supplier.promised) {
      // Ordered: the promised date, moved by how early or late this supplier
      // usually is. DMC's numbers: late on a share of deliveries, by so many days.
      const lateness = (history.lateness || []).filter((days) => days !== null && days !== undefined)
      const share = recordShare(lateness.length)
      const usualLate = Number(theirs.usualLateDays) || 0
      const start = { typical: (LATE_SHARES[theirs.lateFrequency] || 0) * usualLate, quick: 0, slow: usualLate }
      const late = lateness.length
        ? {
            typical: share * median(lateness) + (1 - share) * start.typical,
            quick: share * percentile(lateness, 0.25) + (1 - share) * start.quick,
            slow: share * percentile(lateness, 0.75) + (1 - share) * start.slow,
          }
        : start

      const promisedAt = dateToTime(supplier.promised)
      const overdueDays = (now - promisedAt) / DAY
      // Days overdue by the calendar in the Philippines: promised Nov 2, on
      // Nov 5 it's 3 days overdue, whatever the hour.
      const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const daysPastPromise = Math.round((Date.parse(today) - Date.parse(supplier.promised)) / DAY)

      if (daysPastPromise >= 1) {
        // Already late: what that supplier's late deliveries usually took, at least 1 more day.
        const lateOnes = lateness.filter((days) => days > 0)
        const usualWhenLate = lateOnes.length
          ? share * median(lateOnes) + (1 - share) * (usualLate || 3)
          : usualLate || 3
        const more = Math.max(usualWhenLate - overdueDays, 1)
        arrival = { typical: now + more * DAY, quick: now + DAY, slow: now + (more + 3) * DAY }
        overdue.push({ name: supplier.name, days: daysPastPromise })
      } else {
        arrival = {
          typical: promisedAt + late.typical * DAY,
          quick: promisedAt + late.quick * DAY,
          slow: promisedAt + late.slow * DAY,
        }
      }

      confidences.push(confidenceFor(lateness))
    } else {
      // Not ordered yet: its usual time from PO to delivery, plus DMC's extra
      // days if that falls in a busy month.
      const startingLead = (Number(theirs.usualLeadDays) || starting.supplier_lead) + busyExtraFor(laneStarts.typical)
      const span = blendStep(history.leadDays || [], startingLead)
      // DMC's "usually late by" widens the slow case of its starting value.
      const slow = history.leadDays?.length
        ? span.slow
        : Math.max(span.slow, startingLead + (Number(theirs.usualLateDays) || 0))

      arrival = {
        typical: laneStarts.typical + span.typical * DAY,
        quick: laneStarts.quick + span.quick * DAY,
        slow: laneStarts.slow + slow * DAY,
      }
      confidences.push(span.confidence)
    }

    // Nothing arrives before now.
    ends.typical = Math.max(ends.typical, arrival.typical, now)
    ends.quick = Math.max(ends.quick, arrival.quick, now)
    ends.slow = Math.max(ends.slow, arrival.slow, now)
  }

  return { ends, overdue, confidence: confidences.length ? Math.round(average(confidences)) : null }
}


// =============================================================================
// One order's estimate
// =============================================================================

// order:   id, status, created_at, requested_ship_date (or preferred_ship_date)
// context: everything optional; without it the steps use the records and the
//          default starting values only.
//   startingDays  DMC's starting values (DEFAULT_STARTING_DAYS's keys)
//   suppliers     see supplierArrivals; without them the supplier step uses
//                 the records of the whole step
//   cases         cases ordered, for labeling_per_1000_cases
//   country       { sailingDays, extraLabelingDays } for the customer's country
//   busyMonths    { 1-12: extra days } for suppliers ordered from in that month
//   now           the moment to estimate from (default: now)
export function predictOrder(order, stageStatistics, historyByOrder, context = {}) {
  const now = context.now ? new Date(context.now).getTime() : Date.now()
  const currentStatus = normalizeStatus(order.status)
  const starting = { ...DEFAULT_STARTING_DAYS, ...(context.startingDays || {}) }
  const orderHistory = [...(historyByOrder[order.id] || [])].sort(byTime)
  const requestedShipDate = order.requested_ship_date || order.preferred_ship_date || null

  const lastChangeInto = (status) => {
    const entry = [...orderHistory].reverse().find((item) => normalizeStatus(item.new_status) === status)
    return entry ? new Date(entry.changed_at) : null
  }

  if (currentStatus === 'shipped') {
    return { ...order, currentStatus, shipped: true, shippedOn: lastChangeInto('shipped'), requestedShipDate }
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

  const statsFor = (key) => stageStatistics?.[key]?.durations || []
  const country = context.country || {}
  const busyMonths = context.busyMonths || {}
  const busyExtraFor = (time) => Number(busyMonths[new Date(time + 8 * 60 * 60 * 1000).getUTCMonth() + 1]) || 0

  // DMC's starting values, adjusted for this order where DMC said labeling
  // takes longer: some countries, and bigger orders.
  const startingFor = {
    payment_check: starting.payment_check,
    ordering: starting.ordering,
    suppliers: starting.supplier_lead,
    labeling: starting.labeling + (Number(country.extraLabelingDays) || 0)
      + (Number(starting.labeling_per_1000_cases) || 0) * (Number(context.cases) || 0) / 1000,
    shipping: starting.shipping,
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

  const firstStep = ifPaidToday ? 0 : ESTIMATE_STEPS.indexOf(currentStep)

  for (const step of ESTIMATE_STEPS.slice(firstStep)) {
    const isCurrent = step === currentStep
    const full = blendStep(statsFor(step.key), startingFor[step.key])

    if (step.key === 'suppliers' && context.suppliers?.length) {
      const { ends, overdue, confidence } = supplierArrivals(context.suppliers, lanes, now, starting, busyExtraFor)
      lanes.typical = ends.typical
      lanes.quick = ends.quick
      lanes.slow = ends.slow
      overdueSuppliers = overdue
      overdue.forEach((supplier) => {
        reasons.push(`${supplier.name}'s delivery is ${supplier.days} ${supplier.days === 1 ? 'day' : 'days'} overdue.`)
      })
      if (confidence !== null) confidences.push(confidence)
    } else {
      const span = isCurrent ? remainingOfStep(full, statsFor(step.key), startingFor[step.key], currentStageAge) : full

      if (isCurrent && currentStageAge > full.slow) {
        stuckStep = { key: step.key, label: step.label, days: Math.round(currentStageAge), usualDays: Math.round(full.typical) }
        reasons.push(`In ${step.label.toLowerCase()} for ${stuckStep.days} days, usually ${stuckStep.usualDays}.`)
      }

      lanes.typical += span.typical * DAY
      lanes.quick += span.quick * DAY
      lanes.slow += span.slow * DAY
      confidences.push(full.confidence)
    }

    stepsAhead.push({ key: step.key, label: step.label, expectedEnd: new Date(lanes.typical) })
    if (step.key === 'labeling') readyLanes = { ...lanes }
  }

  // An order already ready for shipment was ready when it got there.
  const estimatedReadyDate = currentStatus === 'ready for shipment'
    ? enteredAt
    : new Date(readyLanes?.typical ?? lanes.typical)

  const estimatedShipDate = new Date(lanes.typical)
  const shipDateRange = { quick: new Date(lanes.quick), slow: new Date(lanes.slow) }

  const sailingDays = Number(country.sailingDays)
  const estimatedArrivalDate = sailingDays > 0 ? new Date(lanes.typical + sailingDays * DAY) : null

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

  // What the customer is told: never a supplier's name.
  let customerNote = null
  if (daysPastRequested > 0) customerNote = 'May be later than your requested date. DMC will contact you.'
  else if (overdueSuppliers.length) customerNote = 'Waiting for goods from our suppliers.'
  else if (reasons.length) customerNote = 'Taking a little longer than usual.'
  else if (requestedShipDate) customerNote = 'On track for your requested date.'

  return {
    ...order,
    currentStatus,
    ifPaidToday,
    estimatedReadyDate,
    estimatedShipDate,
    shipDateRange,
    estimatedArrivalDate,
    requestedShipDate,
    daysPastRequested,
    confidence,
    roughEstimate,
    risk,
    riskReason: reasons[0] || (roughEstimate
      ? 'A rough estimate: there are few finished orders to learn from yet.'
      : 'Order is progressing within expectations.'),
    riskReasons: reasons,
    // The same, as data, for the staff alerts (server/alerts.js).
    stuckStep,
    overdueSuppliers,
    customerNote,
    stepsAhead,
    currentStageAge,
    expectedRemainingDays: Math.max(0, (lanes.typical - now) / DAY),
  }
}
