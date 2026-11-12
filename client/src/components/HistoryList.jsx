import { useEffect, useState } from 'react'

import { supabase } from '../supabase'
import { formatDateTime } from '../utils/dates'
import { historyEntryBy } from '../utils/purchaseOrderHistory'
import { describePayment } from '../utils/paymentHistory'
import { describeLabelStep } from '../utils/labelHistory'


// =============================================================================
// A record's history: every step with the date and time the database saved it
// and who did it, oldest first. Used for an order's payments and a label's
// steps (db/migrations/026); a PO's history has its own list
// (components/PurchaseOrderHistory.jsx).
// =============================================================================
function HistoryList({ title, note, state, describe, missing, empty }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800">
        {title}
      </h3>
      <p className="mb-3 mt-1 text-xs text-gray-500">
        {note}
      </p>

      {state.loading ? (
        <p className="text-sm text-gray-500">Loading the history...</p>
      ) : state.unavailable ? (
        <p className="text-sm text-gray-500">{missing}</p>
      ) : state.entries.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {state.entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-4">
              <span className="shrink-0 text-gray-500 tabular-nums sm:w-48">
                {formatDateTime(entry.happened_at)}
              </span>

              <span className="min-w-0 flex-1 text-gray-800">
                {describe(entry)}
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


// Loads a record's history, oldest first. reloadKey: anything that changes when
// the record does, so the list is read again.
function useHistory(table, columns, column, id, reloadKey) {
  const [state, setState] = useState({ entries: [], loading: true, unavailable: false })

  useEffect(() => {
    if (!id) return undefined
    let active = true

    supabase
      .from(table)
      .select(columns)
      .eq(column, id)
      .order('happened_at', { ascending: true })
      .then(({ data, error }) => {
        if (!active) return
        if (error) console.error(`Failed to load ${table}:`, error)
        setState({ entries: error ? [] : data || [], loading: false, unavailable: Boolean(error) })
      })

    return () => { active = false }
  }, [table, columns, column, id, reloadKey])

  return state
}


// An order's payments: each one sent by the customer, then verified or
// rejected by sales. Only admin, sales and management can read them.
export function PaymentHistory({ orderId, reloadKey }) {
  const state = useHistory('customer_order_payment_history', 'id, event, amount, details, happened_at, done_by_name, done_by_role', 'customer_order_id', orderId, reloadKey)

  return (
    <HistoryList
      title="Payments"
      note="Each payment, with the date and time the system saved it."
      state={state}
      describe={describePayment}
      missing="The payment history isn't available yet (db/migrations/026 hasn't been run)."
      empty="No payment sent yet."
    />
  )
}


// A compliance label's steps. Staff only.
export function LabelHistory({ exchangeId, reloadKey }) {
  const state = useHistory('label_exchange_history', 'id, from_status, to_status, details, happened_at, done_by_name, done_by_role', 'exchange_id', exchangeId, reloadKey)

  if (!exchangeId) return null

  return (
    <HistoryList
      title="History"
      note="Each step of this label, with the date and time the system saved it."
      state={state}
      describe={describeLabelStep}
      missing="The label's history isn't available yet (db/migrations/026 hasn't been run)."
      empty="Nothing saved yet."
    />
  )
}
