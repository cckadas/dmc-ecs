// =============================================================================
// When an order's container left (db/migrations/034)
//
// An order ships in full ("shipped"), or in part after a rush shipment
// ("partly shipped": the goods that hadn't arrived wait for the customer's next
// order). Either way its container has left. A partly shipped order becoming
// "shipped" later is its waiting goods leaving with the next order, not its
// own container, so that isn't a ship day.
//
// The rush itself is marked in the order's history: it moved on from
// procurement to the warehouse by the customer's choice, not because every
// delivery came, so the estimates don't learn supplier times from that step.
//
// Pure, no imports: the website and DMC's server both use it.
// =============================================================================

export const PARTLY_SHIPPED = 'partly shipped'
export const RUSH_STEP = 'procurement (rush shipment)'

const normalize = (status) => String(status || '').trim().toLowerCase()

// Its container has left: shipped, or partly shipped.
export const hasShipped = (status) => {
  const value = normalize(status)
  return value === 'shipped' || value === PARTLY_SHIPPED
}

// A history entry that is the order's own container leaving.
export const isShipEntry = (entry) =>
  hasShipped(entry?.new_status) && normalize(entry?.previous_status) !== PARTLY_SHIPPED

// The history entry of the latest time its container left, or null.
export function lastShipEntry(entries = []) {
  let latest = null
  for (const entry of entries || []) {
    if (!isShipEntry(entry)) continue
    if (!latest || Date.parse(entry.changed_at) > Date.parse(latest.changed_at)) latest = entry
  }
  return latest
}

// The entry is the rush step (procurement → warehouse preparation by the
// customer's agreement).
export const isRushStep = (entry) => normalize(entry?.previous_status) === RUSH_STEP

// The order was rushed: some of its history is the customer's choice, not
// DMC's or the suppliers' pace.
export const wasRushed = (entries = []) => (entries || []).some(isRushStep)
