// =============================================================================
// Purchase order history (db/migrations/023)
//
// Every step of a PO, with the date and time the database saved it and who did
// it: created, each supplier's PFI and payment, each delivery, and status
// changes. These turn the saved entries into words and into the times of the
// PO's progress steps.
// =============================================================================

const peso = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const dayText = (dateString) =>
  new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })


// What happened, in words. lookups names the PO's suppliers and products by id.
export function describeHistoryEntry(entry, { supplierName = () => null, productName = () => null, supplierCount = 1 } = {}) {
  const details = entry.details || {}
  const supplier = supplierName(entry.supplier_id) || 'The supplier'

  switch (entry.event) {
    case 'created':
      return supplierCount > 1 ? 'Purchase order created and sent to the suppliers' : 'Purchase order created and sent to the supplier'

    case 'pfi received':
      return `${supplier}'s PFI received${details.amount ? ` (${peso(details.amount)})` : ''}`

    case 'paid':
      return `${supplier} paid${details.amount ? ` ${peso(details.amount)}` : ''}${
        details.payment_date && !details.day_only ? ` (payment date ${dayText(details.payment_date)})` : ''
      }`

    case 'goods received': {
      const product = productName(details.product_id) || 'A product'
      const before = Number(details.before) || 0
      const after = Number(details.after) || 0
      const ordered = Number(details.ordered) || 0

      if (after < before) return `${product}: received count corrected from ${before} to ${after}`
      if (details.filled_in) return `${product}: all ${after} received`
      return `${product}: ${after - before} received (${after} of ${ordered} so far)`
    }

    case 'status changed': {
      const to = String(details.to || '').trim().toLowerCase()
      if (to === 'fully delivered') return 'All goods received (fully delivered)'
      if (to === 'partially delivered') return 'Partly delivered'
      return `Status changed to ${details.to || 'unknown'}`
    }

    default:
      return entry.event
  }
}


// Who did it: the person, or where a filled-in entry came from.
export function historyEntryBy(entry) {
  if (entry.done_by_name) return entry.done_by_role ? `${entry.done_by_name} (${entry.done_by_role})` : entry.done_by_name
  return entry.details?.filled_in ? 'From saved records' : 'System'
}


// When it happened. A payment filled in from an older PO has only its day.
export const historyEntryDayOnly = (entry) => Boolean(entry.details?.day_only)


// When the PO reached each of its four progress steps (Sent to Supplier,
// Awaiting Delivery, Partially Delivered, Fully Delivered), from its history.
// Each is { at, dayOnly } or null.
export function progressStepTimes(entries = []) {
  const first = (test) => {
    const entry = entries.find(test)
    return entry ? { at: entry.happened_at, dayOnly: historyEntryDayOnly(entry), day: entry.details?.payment_date } : null
  }
  const statusTo = (status) => (entry) =>
    entry.event === 'status changed' && String(entry.details?.to || '').trim().toLowerCase() === status

  return [
    first((entry) => entry.event === 'created'),
    first((entry) => entry.event === 'paid'),
    first((entry) => entry.event === 'goods received' && Number(entry.details?.after) > Number(entry.details?.before)),
    first(statusTo('fully delivered')),
  ]
}
