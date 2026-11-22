// =============================================================================
// Payment history (db/migrations/026)
//
// Every payment of an order, with the date and time the database saved it and
// who did it: sent by the customer, then verified or rejected by sales. This
// turns a saved entry into words.
// =============================================================================

const peso = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`


// What happened, in words. An order's first payment is its down payment (or all
// of it at once); what's paid after that is the balance, or part of it.
export function describePayment(entry) {
  const details = entry.details || {}
  const inFull = details.in_full || details.fully_paid
  const kind = details.first ? (inFull ? 'Full payment' : 'Down payment') : inFull ? 'Balance' : 'Payment'
  const what = entry.amount === null || entry.amount === undefined ? kind : `${kind} of ${peso(entry.amount)}`

  switch (entry.event) {
    case 'payment sent':
      return `${what} sent by the customer${details.bank ? ` (${details.bank})` : ''}`

    case 'payment verified':
      return `${what} verified${details.fully_paid ? ': the order is fully paid' : ''}`

    case 'payment rejected':
      return `${what} rejected${details.reason ? `: ${details.reason}` : ''}`

    default:
      return entry.event
  }
}
