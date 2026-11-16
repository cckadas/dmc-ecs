// =============================================================================
// A product's deliveries — every time it came in
//
// Each time the warehouse receives goods, the database saves it in the PO's
// history (db/migrations/023): the product, how many came, when, and who
// received them. This lists one product's receivings, newest first, each
// against the date its PO promised, with how long the product usually takes
// from its PO to all of it being in, and what's still to come.
//
// Descriptive only. The estimates go by the supplier, not the product: a
// supplier's products on a PO come together, and the order waits for all of
// them (utils/predictions.js).
//
// Goods received within a day of their PO are a test run (utils/testRuns.js):
// listed and marked, but left out of the usual days.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { spanOf } from './predictions.js'
import { SCORE_WINDOW_DAYS, manilaDate } from './supplierScores.js'
import { isTestRun } from './testRuns.js'

const DAY = 24 * 60 * 60 * 1000
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY)


//   lines:     the product's PO lines [{ id, supplier_id, ordered_quantity,
//              received_quantity, fully_received_at,
//              purchase_orders: { id, po_number, created_at, expected_delivery_date } }]
//   events:    its "goods received" entries in the POs' history
//              [{ id, supplier_id, details: { item_id, before, after, ordered, filled_in }, happened_at }]
//   suppliers: { supplier id: name }
// Returns:
//   received  each receiving, newest first: { id, lineId (its PO line), at,
//             poNumber, supplier, cases, soFar, ordered,
//             kind: 'full' | 'part' | 'correction', promised,
//             daysAfterPromise (below 0 when early), test }
//   usual     days from PO to all of it in, over the last 12 months: the middle
//             value with the quicker and slower quarters; null with fewer than 3 POs
//   full      the POs it came in whole on in the last 12 months (test runs aside)
//   late      how many of those came after the promised date; judged: how many had one
//   toCome    { cases, pos, nextPromised }: what's still on order
//   tests     the receivings marked as test runs
export function productDeliveries({ lines = [], events = [], suppliers = {}, today = new Date() }) {
  const lineOf = new Map(lines.map((line) => [line.id, line]))
  const since = manilaDate(new Date(today).getTime() - SCORE_WINDOW_DAYS * DAY)
  const received = []
  const withEntries = new Set()

  const row = ({ id, line, at, before, after }) => {
    const po = line.purchase_orders || {}
    const ordered = Number(line.ordered_quantity) || 0
    const promised = po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : null

    return {
      id,
      lineId: line.id,
      at,
      poNumber: po.po_number || null,
      supplier: suppliers[line.supplier_id] || null,
      cases: after - before,
      soFar: after,
      ordered,
      kind: after < before ? 'correction' : after >= ordered ? 'full' : 'part',
      promised,
      daysAfterPromise: promised ? daysBetween(promised, manilaDate(at)) : null,
      test: Boolean(po.created_at) && isTestRun(po.created_at, at),
    }
  }

  for (const event of events) {
    const line = lineOf.get(event.details?.item_id)
    if (!line) continue
    withEntries.add(line.id)
    received.push(row({ id: event.id, line, at: event.happened_at, before: Number(event.details.before) || 0, after: Number(event.details.after) || 0 }))
  }

  // A line fully received with no entry in the history (saved before the
  // history was): the one time it's known to have come in.
  for (const line of lines) {
    if (withEntries.has(line.id) || !line.fully_received_at) continue
    received.push(row({ id: `line:${line.id}`, line, at: line.fully_received_at, before: 0, after: Number(line.received_quantity) || 0 }))
  }

  received.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  // From PO to all of it in, on each PO of the last 12 months.
  const days = []
  let late = 0
  let judged = 0

  for (const line of lines) {
    const po = line.purchase_orders
    if (!line.fully_received_at || !po?.created_at) continue
    if (isTestRun(po.created_at, line.fully_received_at)) continue

    const inOn = manilaDate(line.fully_received_at)
    if (inOn < since) continue

    days.push(daysBetween(manilaDate(po.created_at), inOn))
    if (po.expected_delivery_date) {
      judged++
      if (inOn > String(po.expected_delivery_date).slice(0, 10)) late++
    }
  }

  const span = spanOf(days)
  const open = lines.filter((line) => (Number(line.ordered_quantity) || 0) > (Number(line.received_quantity) || 0) && line.purchase_orders?.id)

  return {
    received,
    usual: span ? { typical: span.typical, quick: span.quick, slow: span.slow } : null,
    full: days.length,
    late,
    judged,
    toCome: {
      cases: open.reduce((sum, line) => sum + (Number(line.ordered_quantity) || 0) - (Number(line.received_quantity) || 0), 0),
      pos: new Set(open.map((line) => line.purchase_orders.id)).size,
      nextPromised: open.map((line) => line.purchase_orders.expected_delivery_date).filter(Boolean).map((date) => String(date).slice(0, 10)).sort()[0] || null,
    },
    tests: received.filter((entry) => entry.test).length,
  }
}
