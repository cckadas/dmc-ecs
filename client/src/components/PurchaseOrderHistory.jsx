import { formatDateTime } from '../utils/dates'
import { describeHistoryEntry, historyEntryBy, historyEntryDayOnly } from '../utils/purchaseOrderHistory'


const dayText = (dateString) =>
  new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })


// =============================================================================
// A PO's history: every step with the date and time the system saved it, and
// who did it (utils/purchaseOrderHistory.js, db/migrations/023).
// =============================================================================
export default function PurchaseOrderHistory({ entries, items = [], loading = false, unavailable = false }) {
  // A payment filled in from an older PO has only its day (placed at noon), so
  // it's never listed before the PO was created.
  const createdAt = Date.parse(entries.find((entry) => entry.event === 'created')?.happened_at) || 0
  const placedAt = (entry) => (historyEntryDayOnly(entry) ? Math.max(Date.parse(entry.happened_at), createdAt + 1) : Date.parse(entry.happened_at))
  const ordered = [...entries].sort((a, b) => placedAt(a) - placedAt(b))

  const suppliers = new Map(items.map((item) => [item.supplier_id, item.suppliers?.supplier_name]))
  const products = new Map(items.map((item) => [item.product_id, item.products?.product_name]))
  const lookups = {
    supplierName: (id) => suppliers.get(id),
    productName: (id) => products.get(id),
    supplierCount: suppliers.size,
  }

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-gray-800">
        History
      </h3>
      <p className="mb-3 mt-1 text-xs text-gray-500">
        Each step, with the date and time the system saved it.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading the history...</p>
      ) : unavailable ? (
        <p className="text-sm text-gray-500">The history isn't available yet (db/migrations/023 hasn't been run).</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing saved yet.</p>
      ) : (
        <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {ordered.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-4">
              <span className="shrink-0 text-gray-500 tabular-nums sm:w-48">
                {historyEntryDayOnly(entry)
                  ? `${dayText(entry.details.payment_date)} (time not recorded)`
                  : formatDateTime(entry.happened_at)}
              </span>

              <span className="min-w-0 flex-1 text-gray-800">
                {describeHistoryEntry(entry, lookups)}
              </span>

              <span className="shrink-0 text-xs text-gray-500">
                {historyEntryBy(entry)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
