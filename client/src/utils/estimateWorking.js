// =============================================================================
// An estimate's working, in words — for staff
//
// predictOrder (utils/predictions.js) returns how an order's date was worked
// out: each step still to come, the days it adds, and the records those days
// come from. This puts it into rows a person can check by hand: the steps'
// days add up to the ship date, and each step's days can be found again on the
// charts under "What the predictions learn from".
//
// It names suppliers, so it's shown to staff only: a customer's estimate
// (utils/estimateLoader.js forCustomer) never carries it.
// =============================================================================

import { count, formatDays, formatPercent } from './chartFormat.js'

const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })

// A moment, or a YYYY-MM-DD day, as "Nov 4" in the Philippines.
const dayOf = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
  ? dayFormat.format(new Date(`${value.slice(0, 10)}T12:00:00+08:00`))
  : dayFormat.format(new Date(value)))

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// The labeling kinds (utils/labelingKind.js), in words.
const KIND = {
  regular: 'a repeat order in a 20-ft container',
  big: 'a repeat order in a 40-ft container',
  new: 'an order with new labels: a first order, or a product new to this customer',
}

const lowerFirst = (text) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : '')
const deliveries = (number) => count(number, 'delivery', 'deliveries')

// Too small a difference to mention.
const NEGLIGIBLE_DAYS = 0.05


// Whose deliveries a supplier's days came from.
function leanText(lean) {
  if (!lean) return 'no deliveries on record yet'
  if (!lean.all) return `its own ${deliveries(lean.own)}`
  if (!lean.own) return `every supplier's ${deliveries(lean.all)}, as it has none of its own yet`
  return `its own ${deliveries(lean.own)} count for ${formatPercent(lean.share)}, every supplier's ${lean.all} for the rest`
}

// The same, for an overdue delivery: only the deliveries that came that late.
function lateLeanText(lean) {
  if (!lean.all) return `${lean.own} of its own`
  if (!lean.own) return `${lean.all} of every supplier's, as none of its own came this late`
  return `${lean.own} of its own count for ${formatPercent(lean.share)}, ${lean.all} of every supplier's for the rest`
}


// One supplier: its own date, and what that came from.
function supplierLine(supplier) {
  const name = supplier.name || 'A supplier'

  if (supplier.state === 'received') return `${name}: received ${dayOf(supplier.receivedOn)}.`

  if (supplier.state === 'overdue') {
    const more = supplier.lean
      ? `Deliveries that came this late took about ${formatDays(supplier.moreDays)} more (${lateLeanText(supplier.lean)})`
      : "No delivery on record came this late, so it's counted as 1 more day"
    return `${name}: promised ${dayOf(supplier.promised)}, now ${count(supplier.overdueDays, 'day')} overdue. ${more}, so around ${dayOf(supplier.expectedAt)}.`
  }

  if (supplier.state === 'ordered') {
    if (!supplier.lean && !supplier.model) return `${name}: promised ${dayOf(supplier.promised)}. No deliveries on record yet, so its promised day.`

    const late = supplier.usualLate
    const usually = late >= 0.5 ? `${formatDays(late)} late` : late <= -0.5 ? `${formatDays(-late)} early` : 'on its promised day'
    const basis = supplier.model ? 'by the TensorFlow.js model' : leanText(supplier.lean)
    return `${name}: promised ${dayOf(supplier.promised)}. It usually comes ${usually} (${basis}), so around ${dayOf(supplier.expectedAt)}.`
  }

  // No PO yet.
  if (supplier.fromStep) {
    return `${name}: no PO yet. No supplier has a delivery on record, so the usual ${formatDays(supplier.usualDays)} of this step (${count(supplier.records, 'finished order')}), so around ${dayOf(supplier.expectedAt)}.`
  }

  const busy = Math.abs(supplier.busyExtra || 0) >= NEGLIGIBLE_DAYS
    ? `, ${supplier.busyExtra > 0 ? 'plus' : 'less'} ${formatDays(Math.abs(supplier.busyExtra))} for a PO sent in ${MONTHS[supplier.month - 1]}`
    : ''
  const model = supplier.model ? `. With the TensorFlow.js model, ${formatDays(supplier.usualDays)}` : ''
  return `${name}: no PO yet. Usually ${formatDays(supplier.leadDays)} from PO to delivery (${leanText(supplier.lean)})${busy}${model}, so around ${dayOf(supplier.expectedAt)}.`
}


// How much its customer's pace at sending designs moves its labeling.
function designLine(step) {
  const extra = step.designExtra || 0
  if (Math.abs(extra) < NEGLIGIBLE_DAYS) return null
  return `${extra > 0 ? 'Plus' : 'Less'} ${formatDays(Math.abs(extra))}: this customer usually takes ${extra > 0 ? 'longer' : 'less time'} than others to send its label designs (from ${count(step.paceOrders, 'of its orders', 'of its orders')} so far).`
}


// One step's working, as sentences.
function linesFor(step) {
  if (step.how === 'suppliers') {
    const waiting = step.suppliers.filter((supplier) => supplier.state !== 'received')
    const lines = step.suppliers.map(supplierLine)

    if (!waiting.length) lines.push('Every delivery is in.')
    else if (waiting.length > 1) {
      lines.push(`The order waits for all ${waiting.length}, and the more it waits on, the likelier one of them runs late: all in by around ${dayOf(step.endsOn)}.`)
    }
    return lines
  }

  if (step.how === 'labels') {
    const pieces = step.pieces.map((piece) => `${lowerFirst(piece.label)} (${piece.current ? `about ${formatDays(piece.days)} more` : formatDays(piece.days)})`)
    const records = Math.min(...step.pieces.map((piece) => piece.records))
    return [
      `From where its labels are: ${lowerFirst(step.waiting)} for ${formatDays(step.daysIn)}.`,
      `Still to come: ${pieces.join(', then ')}.`,
      `Each from how long that piece took on ${count(records, 'finished order')}${step.kind ? `, leaning on those like it (${KIND[step.kind]})` : ''}${step.paceOrders ? `; the design by this customer's own pace (${count(step.paceOrders, 'of its orders', 'of its orders')})` : ''}.`,
    ]
  }

  const like = step.kind && step.kindRecords > 0
    ? `${count(step.kindRecords, 'finished order')} like it (${KIND[step.kind]}) ${step.kindRecords === 1 ? 'counts' : 'count'} for ${formatPercent(step.share)}, every finished order's (${step.records}) for the rest`
    : step.kind
      ? `no order like it (${KIND[step.kind]}) has finished yet, so every finished order's (${step.records})`
      : null

  const lines = []

  if (step.how === 'model') {
    lines.push(`The TensorFlow.js model's days for an order of this size, kind, country and month${step.current ? `, less the ${formatDays(step.daysIn)} it has been in this step` : ''}.`)
  } else if (step.how === 'remaining') {
    const left = step.days - (step.designExtra || 0)
    lines.push(step.longer > 0
      ? `In this step for ${formatDays(step.daysIn)} so far. ${step.longer} of ${count(step.records, 'finished order')} took longer than that, and needed about ${formatDays(left)} more.`
      : `In this step for ${formatDays(step.daysIn)} so far, longer than all ${count(step.records, 'finished order')} took, so it's counted as 1 more day.`)
    if (like) lines.push(`${like.charAt(0).toUpperCase()}${like.slice(1)}.`)
  } else {
    lines.push(like ? `The middle value: ${like}.` : `The middle value of ${count(step.records, 'finished order')}.`)
  }

  const design = designLine(step)
  if (design) lines.push(design)
  return lines
}


// The working as rows: each step still to come, the days it adds, the day it
// should be done, and what those days came from. Null without a working (no
// estimate yet, or one made for a customer).
//   rows     [{ key, label, current, days, endsOn, lines: [sentence] }]
//   total    the steps' days added up: the days from now to the ship date
//   range    one sentence on the likely dates
//   sailing  { days, arrivesOn, line }, with an arrival estimate
export function describeWorking(working) {
  if (!working?.steps?.length) return null

  const rows = working.steps.map((step) => ({
    key: step.key,
    label: step.label,
    current: Boolean(step.current),
    days: step.days,
    endsOn: step.endsOn,
    lines: linesFor(step),
  }))

  const sailing = working.sailing
  const to = sailing?.country ? ` to ${String(sailing.country).trim()}` : ''

  return {
    from: working.from,
    ifPaidToday: Boolean(working.ifPaidToday),
    rows,
    total: rows.reduce((sum, row) => sum + row.days, 0),
    shipsOn: working.shipsOn,
    range: working.range
      ? `Likely ${dayOf(working.range.quick)} to ${dayOf(working.range.slow)}: each step's quicker and slower cases added up (the quicker and slower quarters of its past records).`
      : null,
    sailing: sailing ? {
      days: sailing.days,
      arrivesOn: sailing.arrivesOn,
      line: sailing.nearest
        ? `The days at sea${to}: it has ${count(sailing.arrivals || 0, 'recorded arrival')} so far, so it leans on ${sailing.nearest}'s${sailing.nearestArrivals ? ` (${sailing.nearestArrivals})` : ''}, the nearest country with enough.`
        : `The days at sea${to}: the middle value of ${count(sailing.arrivals || 0, 'recorded arrival')}.`,
    } : null,
  }
}
