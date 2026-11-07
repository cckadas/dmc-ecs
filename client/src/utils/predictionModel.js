// =============================================================================
// The prediction model: its records, its features and its final arithmetic
//
// A small neural network (one hidden layer of 8 units) for each of the two
// step times the statistics give everyone the same number for:
//   supplier   days early (below 0) or late against the promised date, from
//              which supplier, the cases and products ordered from it, the
//              month the PO went out, and the days it was given
//   labeling   days from the goods coming in to the labels applied, from the
//              cases and products in the order, whether its customer or one of
//              its products is new, whether it fills a 40-ft, its country and
//              the month
//
// TensorFlow.js trains it in the browser (utils/modelTrainer.js, from the
// Predictive Analytics page) and its weights are saved in the database
// (db/migrations/019). The estimates, on every screen and the server, use only
// the arithmetic here, so they all give the same date without TensorFlow.js.
//
// Imports carry their .js extension so the server (Node) can load this too.
// =============================================================================

import { LATE_SHARES, USUAL_LATE_FREQUENCY, blendStep, recordShare } from './predictions.js'
import { startingDaysFrom } from './estimateInputs.js'
import { manilaDate } from './supplierScores.js'
import { LABELING_SETTING, isBigContainer, labelingKinds } from './labelingKind.js'

export const MODEL_KEYS = { supplier: 'supplier_lateness', labeling: 'labeling_days' }
export const MODEL_MIN_RECORDS = 30     // finished records to learn from before it's tried
export const MODEL_MAX_AGE_DAYS = 7     // older than this, the page retrains it
export const HIDDEN_UNITS = 8
export const CLOSE_DAYS = 3             // "within 3 days", as in the accuracy check

// The labeling model's inputs changed (the order's kind and container), so one
// saved before can't be used: the page trains a new one.
export const LABELING_SPEC_VERSION = 2
export const isOutdatedModel = (row) => row?.key === MODEL_KEYS.labeling && Number(row?.spec?.version || 1) < LABELING_SPEC_VERSION

const DAY = 24 * 60 * 60 * 1000
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY)
const monthOfDay = (day) => Number(String(day).slice(5, 7))
const sum = (values) => values.reduce((total, value) => total + value, 0)
const mean = (values) => (values.length ? sum(values) / values.length : 0)
const spread = (values) => {
  if (values.length < 2) return 1
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1
}
const median = (values) => percentile(values, 0.5)

export function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}


// Records ------------------------------------------------------------------------------

// One per finished supplier delivery: one supplier's part of one PO, once every
// line of it is in. lines: purchase_order_items with ordered_quantity and
// purchase_orders (id, customer_order_id, created_at, expected_delivery_date).
export function supplierRecords(lines) {
  const parts = new Map()

  for (const line of lines) {
    const po = line.purchase_orders
    if (!po?.id || !line.supplier_id || !po.created_at || !po.expected_delivery_date) continue

    const key = `${po.id}:${line.supplier_id}`
    if (!parts.has(key)) parts.set(key, { po, supplierId: line.supplier_id, lines: [] })
    parts.get(key).lines.push(line)
  }

  const records = []

  for (const { po, supplierId, lines: theirs } of parts.values()) {
    if (theirs.some((line) => !line.fully_received_at)) continue

    const orderedOn = manilaDate(po.created_at)
    const promised = String(po.expected_delivery_date).slice(0, 10)
    const receivedAt = Math.max(...theirs.map((line) => Date.parse(line.fully_received_at)))

    records.push({
      orderId: po.customer_order_id,
      supplierId,
      cases: sum(theirs.map((line) => Number(line.ordered_quantity) || 0)),
      products: theirs.length,
      daysGiven: daysBetween(orderedOn, promised),
      month: monthOfDay(orderedOn),
      startedAt: Date.parse(po.created_at),
      knownAt: receivedAt,
      value: daysBetween(promised, manilaDate(receivedAt)),
    })
  }

  return records
}


// One per order that finished labeling: the days from entering warehouse
// preparation (all goods in) to ready for shipment.
//   history: status changes;
//   orders: { id, delivery_location_id, customer_id, created_at, status, container_size };
//   items: { customer_order_id, quantity, product_id }; locations: { id, country }
export function labelingRecords({ history = [], orders = [], items = [], locations = [] }) {
  const kinds = labelingKinds(orders, items)
  const byOrder = new Map()
  for (const entry of history) {
    if (!byOrder.has(entry.customer_order_id)) byOrder.set(entry.customer_order_id, [])
    byOrder.get(entry.customer_order_id).push(entry)
  }

  const linesOf = new Map()
  for (const item of items) {
    if (!linesOf.has(item.customer_order_id)) linesOf.set(item.customer_order_id, [])
    linesOf.get(item.customer_order_id).push(item)
  }

  const countryOf = Object.fromEntries(locations.map((location) => [location.id, location.country]))
  const records = []

  for (const order of orders) {
    const entries = [...(byOrder.get(order.id) || [])].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at))
    const warehouse = [...entries].reverse().find((entry) => entry.new_status?.trim().toLowerCase() === 'warehouse preparation')
    const ready = warehouse && entries.find((entry) => entry.new_status?.trim().toLowerCase() === 'ready for shipment'
      && Date.parse(entry.changed_at) > Date.parse(warehouse.changed_at))
    const lines = linesOf.get(order.id) || []
    if (!warehouse || !ready || !lines.length) continue

    const startedAt = Date.parse(warehouse.changed_at)
    const knownAt = Date.parse(ready.changed_at)
    const days = (knownAt - startedAt) / DAY
    if (days <= 0.05 || days > 60) continue

    const kind = kinds.get(order.id) || null
    records.push({
      orderId: order.id,
      cases: sum(lines.map((line) => Number(line.quantity) || 0)),
      products: lines.length,
      kind,
      newLabels: kind === 'new' ? 1 : 0,
      bigContainer: isBigContainer(order.container_size) ? 1 : 0,
      country: (countryOf[order.delivery_location_id] || '').trim().toLowerCase(),
      month: monthOfDay(manilaDate(startedAt)),
      startedAt,
      knownAt,
      value: days,
    })
  }

  return records
}


// Features -----------------------------------------------------------------------------

const stats = (values) => ({ mean: mean(values), std: spread(values) })
const z = (value, { mean: average, std }) => (value - average) / std
const season = (month) => [Math.sin((2 * Math.PI * (month - 1)) / 12), Math.cos((2 * Math.PI * (month - 1)) / 12)]

// How each record turns into numbers for the network, from its training records.
export function buildSpec(kind, records) {
  const target = stats(records.map((record) => record.value))

  if (kind === 'supplier') {
    return {
      kind,
      suppliers: [...new Set(records.map((record) => record.supplierId))].sort(),
      cases: stats(records.map((record) => Math.log1p(record.cases))),
      products: stats(records.map((record) => record.products)),
      daysGiven: stats(records.map((record) => record.daysGiven)),
      target,
    }
  }

  return {
    kind,
    version: LABELING_SPEC_VERSION,
    countries: [...new Set(records.map((record) => record.country).filter(Boolean))].sort(),
    cases: stats(records.map((record) => record.cases)),
    products: stats(records.map((record) => record.products)),
    target,
  }
}

// The network's inputs for one record. A supplier or country it never saw
// gets the "other" input instead.
export function encode(spec, record) {
  if (spec.kind === 'supplier') {
    const which = spec.suppliers.map((id) => (id === record.supplierId ? 1 : 0))
    return [...which, which.includes(1) ? 0 : 1, z(Math.log1p(record.cases || 0), spec.cases), z(record.products || 1, spec.products), z(record.daysGiven, spec.daysGiven), ...season(record.month)]
  }

  const country = (record.country || '').trim().toLowerCase()
  const which = spec.countries.map((name) => (name === country ? 1 : 0))
  return [...which, which.includes(1) ? 0 : 1, z(record.cases || 0, spec.cases), z(record.products || 1, spec.products), record.newLabels ? 1 : 0, record.bigContainer ? 1 : 0, ...season(record.month)]
}


// The arithmetic ---------------------------------------------------------------------------

// One hidden layer of ReLU units, then one output, as TensorFlow.js trained it.
//   kernel1 [inputs][units], bias1 [units], kernel2 [units][1], bias2 [1]
export function forward({ kernel1, bias1, kernel2, bias2 }, input) {
  const hidden = bias1.map((bias, unit) => Math.max(0, input.reduce((total, value, i) => total + value * kernel1[i][unit], bias)))
  return hidden.reduce((total, value, unit) => total + value * kernel2[unit][0], bias2[0])
}

export function predictValue({ weights, spec }, record) {
  return forward(weights, encode(spec, record)) * spec.target.std + spec.target.mean
}

// How sure the estimates can be, from the share it got within 3 days.
export const confidenceFrom = (withinShare) => Math.max(40, Math.min(95, Math.round(40 + 55 * (Number(withinShare) || 0))))

// A saved model as the estimates ask it: the typical value, and the likely
// range from how far off it was on the records it was tested on.
export function modelPredictor(row) {
  if (!row?.weights || !row?.spec || isOutdatedModel(row)) return null
  const { low = -2, high = 2 } = row.metrics?.residuals || {}

  return {
    key: row.key,
    inUse: Boolean(row.in_use),
    confidence: confidenceFrom(row.metrics?.model?.withinShare),
    predict(record) {
      const typical = predictValue(row, record)
      return { typical, quick: typical + Math.min(low, 0), slow: typical + Math.max(high, 0) }
    },
  }
}


// Judging it ------------------------------------------------------------------------------

export function scoreOf(predicted, actual) {
  const off = predicted.map((value, index) => Math.abs(value - actual[index]))
  return {
    averageDaysOff: mean(off),
    withinShare: off.length ? off.filter((days) => days <= CLOSE_DAYS).length / off.length : 0,
    count: off.length,
  }
}

// What the statistics would have said for each test record, learning from the
// same training records: the baseline the model has to beat.
//   supplier: that supplier's usual lateness, blended with DMC's numbers
//   labeling: the usual labeling days of orders of the same kind, blended with
//             DMC's starting value for that kind
export function statisticsFor(kind, train, test, starting = {}) {
  if (kind === 'supplier') {
    const bySupplier = new Map()
    for (const record of train) {
      if (!bySupplier.has(record.supplierId)) bySupplier.set(record.supplierId, [])
      bySupplier.get(record.supplierId).push(record.value)
    }

    const startingDays = startingDaysFrom(starting.settings)

    return test.map((record) => {
      const lateness = bySupplier.get(record.supplierId) || []
      const theirs = starting.startingSuppliers?.[record.supplierId]
      // Its own numbers from DMC, else DMC's for every supplier (predictions.js).
      const ownLate = theirs?.usual_late_days === null || theirs?.usual_late_days === undefined ? null : Number(theirs.usual_late_days)
      const lateDays = ownLate ?? (Number(startingDays.supplier_late_days) || 0)
      const frequency = theirs?.late_frequency || (lateDays > 0 ? USUAL_LATE_FREQUENCY : null)
      const start = (LATE_SHARES[frequency] || 0) * lateDays
      if (!lateness.length) return start
      const share = recordShare(lateness.length)
      return share * median(lateness) + (1 - share) * start
    })
  }

  const startingDays = startingDaysFrom(starting.settings)
  const durations = train.map((record) => record.value)
  const byKind = { regular: [], big: [], new: [] }
  for (const record of train) byKind[record.kind]?.push(record.value)

  return test.map((record) => {
    const startingValue = Number(startingDays[LABELING_SETTING[record.kind || 'regular']] ?? startingDays.labeling)
    return blendStep(record.kind ? byKind[record.kind] : durations, startingValue).typical
  })
}
