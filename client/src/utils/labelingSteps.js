// =============================================================================
// Labeling, step by step, in the estimates (db/migrations/026)
//
// An order's labeling has six pieces, from the saved steps of its labels:
//   start    its goods reach the warehouse → the original labels' photos are uploaded
//   forward  → sales sends them to the customer
//   design   → the customer sends back its translated design
//   print    → sales confirms the design and prints the labels
//   apply    → the warehouse applies them to the units
//   finish   → the order is ready for shipment
// An order is past a piece once every one of its labels is: the slowest label
// decides, as the slowest supplier does for deliveries.
//
// Learned from the system's own records only:
//   - how long each piece takes, from finished orders of the same labeling kind
//     (utils/labelingKind.js), leaning on every kind's while a kind has few
//   - how long each customer takes to send its designs, against the usual for
//     each order's kind: a customer that took half as long again counts as 1.5.
//     Its own orders count for n ÷ (n + 5), the usual (1) for the rest.
// An order whose labeling went by in under a day (from the warehouse to ready)
// was a test run, so neither is learned from it (utils/testRuns.js).
//
// The estimates (utils/predictions.js) use it two ways:
//   - an order in labeling: what's left is what's left of the piece it's in,
//     plus the pieces after it, instead of labeling as a whole
//   - any other order: its labeling is moved by how much quicker or slower its
//     customer usually sends designs
//
// Imports carry their .js extension so the server (Node) can load this too.
// =============================================================================

import { MIN_RECORDS, blendStep, normalizeStatus, recordShare, remainingOfStep } from './predictions.js'
import { isTestRun } from './testRuns.js'

const DAY = 24 * 60 * 60 * 1000
const MAX_PIECE_DAYS = 120   // longer is a mistake in the records

// The label statuses, in order: a label reaching one ends a piece.
export const LABEL_STATUSES = [
  'original label received',
  'awaiting customer translated design',
  'customer design label received',
  'printed & awaiting application',
  'applied to units',
]

// The six pieces, who each waits on, and words for staff.
export const LABELING_PIECES = [
  { key: 'start', label: "Original labels' photos uploaded", waiting: 'Waiting for the warehouse to upload the original labels', waitingOn: 'warehouse' },
  { key: 'forward', label: 'Sales sends them to the customer', waiting: 'Waiting for sales to send the labels to the customer', waitingOn: 'sales' },
  { key: 'design', label: 'Customer sends its design', waiting: "Waiting for the customer's translated design", waitingOn: 'customer' },
  { key: 'print', label: 'Sales confirms and prints', waiting: 'Waiting for sales to confirm and print the labels', waitingOn: 'sales' },
  { key: 'apply', label: 'Warehouse applies them', waiting: 'Waiting for the warehouse to apply the labels', waitingOn: 'warehouse' },
  { key: 'finish', label: 'Marked ready for shipment', waiting: 'Labels applied; waiting to be marked ready', waitingOn: 'warehouse' },
]

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}


// Each order's labeling, from its labels' saved steps and its status history.
//   labelHistory    [{ exchange_id, to_status, happened_at }]
//   exchanges       [{ id, customer_order_item_id }]   the labels
//   items           [{ id, customer_order_id }]        every order line
//   historyByOrder  { order id: status changes }       (utils/predictions.js)
// Returns a Map of order id to:
//   reachedAt   [B0..B6]: when it reached the warehouse, when every label had
//               reached each status, and when it was ready for shipment (ms, or null)
//   position    how many pieces are behind it (0 to 6)
//   positionAt  when it got past the last of those (null when not known: a
//               label saved before its steps were, with only its latest step)
//   complete    every piece known, for learning from
export function orderLabeling({ labelHistory = [], exchanges = [], items = [], historyByOrder = {} }) {
  const orderOfItem = new Map(items.map((item) => [item.id, item.customer_order_id]))
  const linesPerOrder = new Map()
  for (const item of items) linesPerOrder.set(item.customer_order_id, (linesPerOrder.get(item.customer_order_id) || 0) + 1)

  const orderOfLabel = new Map()
  for (const exchange of exchanges) {
    const orderId = orderOfItem.get(exchange.customer_order_item_id)
    if (orderId) orderOfLabel.set(exchange.id, orderId)
  }

  // When each label last reached each status.
  const reached = new Map()
  for (const label of orderOfLabel.keys()) reached.set(label, Array(LABEL_STATUSES.length).fill(null))
  for (const entry of labelHistory) {
    const times = reached.get(entry.exchange_id)
    const index = LABEL_STATUSES.indexOf(normalizeStatus(entry.to_status))
    const time = Date.parse(entry.happened_at)
    if (!times || index < 0 || !Number.isFinite(time)) continue
    if (times[index] === null || time > times[index]) times[index] = time
  }

  const labelsByOrder = new Map()
  for (const [label, orderId] of orderOfLabel) {
    if (!labelsByOrder.has(orderId)) labelsByOrder.set(orderId, [])
    labelsByOrder.get(orderId).push(reached.get(label))
  }

  const result = new Map()
  for (const [orderId, entries] of Object.entries(historyByOrder)) {
    const sorted = [...entries].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at))
    const intoWarehouse = sorted.filter((entry) => normalizeStatus(entry.new_status) === 'warehouse preparation').at(-1)
    if (!intoWarehouse) continue

    const start = Date.parse(intoWarehouse.changed_at)
    const ready = sorted.find((entry) => normalizeStatus(entry.new_status) === 'ready for shipment' && Date.parse(entry.changed_at) >= start)
    const labels = labelsByOrder.get(orderId) || []
    const allStarted = labels.length > 0 && labels.length >= (linesPerOrder.get(orderId) || 0)

    // Where each label is: the status it reached last (a label sent back a step
    // is back at that step).
    const current = labels.map((times) => times.reduce((last, time, index) => (time !== null && (last < 0 || time >= times[last]) ? index : last), -1))
    const behind = allStarted ? Math.min(...current) + 1 : 0
    const position = ready ? LABELING_PIECES.length : behind

    // When every label had reached each status: the slowest label's time.
    const reachedAt = [start]
    for (let index = 0; index < LABEL_STATUSES.length; index++) {
      const times = labels.map((entry) => entry[index])
      reachedAt.push(allStarted && times.every((time) => time !== null) ? Math.max(reachedAt.at(-1) ?? -Infinity, ...times) : null)
    }
    reachedAt.push(ready ? Date.parse(ready.changed_at) : null)

    result.set(orderId, {
      reachedAt,
      position,
      positionAt: position === 0 ? start : reachedAt[position] ?? null,
      complete: reachedAt.every((time) => time !== null),
    })
  }

  return result
}


// How long each piece took on orders that finished labeling before `before`,
// and each customer's pace at sending designs.
//   kindOf      order id → labeling kind (utils/labelingKind.js), or null
//   customerOf  order id → customer id
// pieces: { key: { all: [days], byKind: { regular, big, new } } }
// designRatios: Map of customer id → [its orders' design days ÷ the usual for their kind]
// tests: the orders left out as test runs
export function labelingStatistics(orders, { kindOf = () => null, customerOf = () => null, before = Infinity } = {}) {
  const pieces = Object.fromEntries(LABELING_PIECES.map((piece) => [piece.key, { all: [], byKind: { regular: [], big: [], new: [] } }]))
  const finished = []
  let tests = 0

  for (const [orderId, steps] of orders) {
    if (!steps.complete || steps.reachedAt[6] >= before) continue
    if (isTestRun(steps.reachedAt[0], steps.reachedAt[6])) {
      tests++
      continue
    }
    const days = LABELING_PIECES.map((_, index) => (steps.reachedAt[index + 1] - steps.reachedAt[index]) / DAY)
    if (days.some((value) => value < 0 || value > MAX_PIECE_DAYS)) continue

    const kind = kindOf(orderId)
    finished.push({ orderId, kind, design: days[2] })
    LABELING_PIECES.forEach((piece, index) => {
      pieces[piece.key].all.push(days[index])
      if (pieces[piece.key].byKind[kind]) pieces[piece.key].byKind[kind].push(days[index])
    })
  }

  const statistics = { pieces, designRatios: new Map(), orders: finished.length, tests }

  for (const { orderId, kind, design } of finished) {
    const usual = pieceSpan(statistics, 'design', kind)?.typical
    const customerId = customerOf(orderId)
    if (!usual || usual <= 0 || !customerId) continue
    if (!statistics.designRatios.has(customerId)) statistics.designRatios.set(customerId, [])
    statistics.designRatios.get(customerId).push(design / usual)
  }

  return statistics
}


// A piece's usual days for an order of this kind, leaning on every kind's while
// the kind has few. pace scales the customer's design. Null with too few records.
export function pieceSpan(statistics, key, kind = null, pace = 1) {
  const piece = statistics?.pieces?.[key]
  if (!piece) return null
  const own = kind ? piece.byKind[kind] || [] : []
  const span = own.length ? blendStep(own, piece.all) : blendStep(piece.all)
  if (!span) return null

  const scale = key === 'design' ? pace : 1
  return { typical: span.typical * scale, quick: span.quick * scale, slow: span.slow * scale }
}


// What's left of a piece an order has been in for `elapsed` days: how much
// longer past orders took once they'd been in it that long, leaning the same way.
function pieceRemaining(statistics, key, kind, elapsed, pace = 1) {
  const piece = statistics?.pieces?.[key]
  if (!piece || piece.all.length < MIN_RECORDS) return null

  const scale = key === 'design' ? pace : 1
  const fromAll = remainingOfStep(piece.all.map((days) => days * scale), elapsed)
  const own = kind ? piece.byKind[kind] || [] : []
  if (!own.length) return fromAll

  const fromOwn = remainingOfStep(own.map((days) => days * scale), elapsed)
  const share = recordShare(own.length)
  const mix = (field) => share * fromOwn[field] + (1 - share) * fromAll[field]
  return { typical: mix('typical'), quick: mix('quick'), slow: mix('slow') }
}


// A customer's pace at sending designs: 1 is usual, 1.5 half as long again.
// Its own orders count for n ÷ (n + 5), the usual for the rest.
export function designPaceOf(statistics, customerId) {
  const ratios = (customerId && statistics?.designRatios?.get(customerId)) || []
  if (!ratios.length) return { pace: 1, orders: 0 }
  const share = recordShare(ratios.length)
  return { pace: share * median(ratios) + (1 - share), orders: ratios.length }
}


// An order in labeling: what's left, piece by piece, from where its labels are.
// Null when a piece has too few records, or where its labels are isn't known.
export function labelingLeft(statistics, { position, positionAt, kind = null, pace = 1, now }) {
  if (positionAt === null || positionAt === undefined || position >= LABELING_PIECES.length) return null

  const elapsed = Math.max(0, (now - positionAt) / DAY)
  const total = { typical: 0, quick: 0, slow: 0 }
  // Each piece still to come and the days it adds, for the staff working.
  const pieces = []

  for (let index = position; index < LABELING_PIECES.length; index++) {
    const key = LABELING_PIECES[index].key
    const span = index === position ? pieceRemaining(statistics, key, kind, elapsed, pace) : pieceSpan(statistics, key, kind, pace)
    if (!span) return null
    total.typical += span.typical
    total.quick += span.quick
    total.slow += span.slow
    pieces.push({ key, label: LABELING_PIECES[index].label, days: span.typical, current: index === position, records: statistics.pieces[key].all.length })
  }

  const piece = LABELING_PIECES[position]
  return { ...total, piece, daysIn: elapsed, usual: pieceSpan(statistics, piece.key, kind, pace), pieces }
}


// Everything an order's estimate needs from the labels (context.labelSteps in
// utils/predictions.js). Null without enough finished orders to learn from.
//   left(now)    what's left of its labeling, when it's in labeling and where
//                its labels are is known
//   designExtra  days its customer's pace adds to (or takes off) its labeling,
//                while its design isn't in yet
export function labelingContext(statistics, orders, { orderId = null, customerId = null, kind = null } = {}) {
  if (!statistics || statistics.orders < MIN_RECORDS) return null

  const { pace, orders: paceOrders } = designPaceOf(statistics, customerId)
  const usualDesign = pieceSpan(statistics, 'design', kind)?.typical ?? null
  const steps = (orderId && orders?.get(orderId)) || null
  const designDone = Boolean(steps && steps.position > 2)

  return {
    pace,
    paceOrders,
    usualDesign,
    designExtra: !designDone && usualDesign !== null ? (pace - 1) * usualDesign : 0,
    left: steps && steps.position < LABELING_PIECES.length && steps.positionAt !== null
      ? (now) => labelingLeft(statistics, { position: steps.position, positionAt: steps.positionAt, kind, pace, now })
      : null,
  }
}


// How long each piece usually takes, for the "Labeling steps" chart: the same
// numbers the estimates go by, from every finished order. The shape of
// utils/analytics.js stepTimes.
export function labelingPieceTimes(statistics) {
  return LABELING_PIECES.map((piece) => {
    const days = statistics?.pieces?.[piece.key]?.all || []
    const span = blendStep(days)
    return {
      key: piece.key,
      label: piece.label,
      typical: span?.typical ?? null,
      quick: span?.quick ?? null,
      slow: span?.slow ?? null,
      records: days.length,
      needed: MIN_RECORDS,
    }
  })
}


// The labels, shaped for the estimates: each order's pieces, what's learned
// from them, and each order's customer, from the rows a loader read.
//   orders: [{ id, customer_id }]
export function labelingRecords({ labelHistory = [], exchanges = [], items = [], orders = [], historyByOrder = {}, kindOf = null, before = Infinity }) {
  const customerOf = new Map(orders.map((order) => [order.id, order.customer_id]))
  const steps = orderLabeling({ labelHistory, exchanges, items, historyByOrder })
  const statistics = labelingStatistics(steps, {
    kindOf: kindOf || (() => null),
    customerOf: (orderId) => customerOf.get(orderId) || null,
    before,
  })
  return { steps, statistics, customerOf }
}
