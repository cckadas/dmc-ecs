import { useEffect, useState } from 'react'

import { loadProductDeliveries } from '../services/analyticsService'
import { count, formatDay, formatDays } from '../utils/chartFormat'
import { formatDateTime } from '../utils/dates'
import TableScroll from './TableScroll'


// =============================================================================
// A product's deliveries, under Sales by product on Predictive Analytics: every
// time it came in, newest first, against the date its PO promised; how long it
// usually takes from its PO to all of it being in; and what's still to come
// (utils/productDeliveries.js). Read when the product is chosen.
//
// It shows what happened. The estimates go by the supplier, whose products on
// a PO come together. Staff only: it names suppliers.
// =============================================================================

const HEAD = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500'
const CELL = 'px-4 py-2.5 align-top text-sm text-gray-700'

const cases = (value) => Math.round(value).toLocaleString('en-US')

// How a receiving compares with the date its PO promised.
function againstPromise(days) {
  if (days === null || days === undefined) return <span className="text-gray-400">No promised date</span>
  if (days > 0) return <span className="font-medium text-red-700">{count(days, 'day')} late</span>
  if (days < 0) return <span className="text-gray-700">{count(-days, 'day')} early</span>
  return <span className="text-gray-700">On the promised day</span>
}


// Give it key={productId}, so choosing another product starts it afresh.
export default function ProductDeliveries({ productId }) {
  const [state, setState] = useState({ data: null, failed: false })
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!productId) return undefined
    let active = true

    loadProductDeliveries(productId)
      .then((data) => { if (active) setState({ data, failed: false }) })
      .catch((error) => {
        console.error("Failed to load the product's deliveries:", error)
        if (active) setState({ data: null, failed: true })
      })

    return () => { active = false }
  }, [productId])

  const loading = !state.data && !state.failed
  const data = state.data
  const shown = data ? (showAll ? data.received : data.received.slice(0, 8)) : []

  let usual = null
  if (data?.full) {
    usual = `It came in whole on ${count(data.full, 'PO')} in the last 12 months`
    usual += data.usual
      ? `, usually ${formatDays(data.usual.typical)} after the PO (most between ${formatDays(data.usual.quick)} and ${formatDays(data.usual.slow)}).`
      : '.'
    if (data.judged) usual += ` ${data.late} of ${data.judged} came after the promised date.`
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-sm font-semibold text-gray-800">How long it takes to come in</p>

      {loading ? (
        <p className="mt-1 text-sm text-gray-500">Loading its deliveries…</p>
      ) : state.failed ? (
        <p className="mt-1 text-sm text-gray-500">Its deliveries couldn't be loaded. Refresh the page to try again.</p>
      ) : !data.received.length && !data.toCome.cases ? (
        <p className="mt-1 text-sm text-gray-500">No purchase order has had this product yet.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-700">
            {usual || 'None of it has come in whole yet in the last 12 months.'}
          </p>
          {data.toCome.cases > 0 && (
            <p className="text-sm text-gray-700">
              Still to come: {cases(data.toCome.cases)} cases on {count(data.toCome.pos, 'PO')}
              {data.toCome.nextPromised ? `, the next promised for ${formatDay(data.toCome.nextPromised)}` : ''}.
            </p>
          )}

          {data.received.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Its deliveries, newest first</p>
              <TableScroll className="mt-1">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={HEAD}>Received</th>
                      <th className={HEAD}>PO</th>
                      <th className={HEAD}>Supplier</th>
                      <th className={`${HEAD} text-right`}>Cases</th>
                      <th className={HEAD}>Promised</th>
                      <th className={HEAD}>Against the promise</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map((entry) => (
                      <tr key={entry.id}>
                        <td className={`${CELL} whitespace-nowrap`}>{formatDateTime(entry.at)}</td>
                        <td className={`${CELL} whitespace-nowrap`}>{entry.poNumber || '—'}</td>
                        <td className={CELL}>{entry.supplier || '—'}</td>
                        <td className={`${CELL} whitespace-nowrap text-right tabular-nums`}>
                          {entry.kind === 'correction' ? (
                            <>
                              <p>corrected to {cases(entry.soFar)}</p>
                              <p className="text-xs text-gray-500">of {cases(entry.ordered)} ordered</p>
                            </>
                          ) : (
                            <>
                              <p>{cases(entry.cases)}</p>
                              <p className="text-xs text-gray-500">
                                {entry.kind === 'full'
                                  ? (entry.cases >= entry.ordered ? 'all of it' : `the last of ${cases(entry.ordered)}`)
                                  : `${cases(entry.soFar)} of ${cases(entry.ordered)} so far`}
                              </p>
                            </>
                          )}
                        </td>
                        <td className={`${CELL} whitespace-nowrap`}>{entry.promised ? formatDay(entry.promised) : '—'}</td>
                        <td className={`${CELL} whitespace-nowrap`}>
                          {entry.test ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Test run</span>
                          ) : entry.kind === 'correction' ? (
                            <span className="text-gray-400">—</span>
                          ) : againstPromise(entry.daysAfterPromise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>

              {data.received.length > 8 && (
                <button type="button" onClick={() => setShowAll((all) => !all)} className="mt-2 text-sm font-medium text-[#2D5A42] hover:underline">
                  {showAll ? 'Show the latest 8' : `Show all ${data.received.length} deliveries`}
                </button>
              )}
            </>
          )}

          <p className="mt-2 text-xs text-gray-500">
            Every time the warehouse received it, as saved in its PO's history.
            {data.tests > 0 && ' Test run: received within a day of its PO, so it\'s left out of the usual days.'}
            {' '}The estimates go by the supplier rather than the product: a supplier's products on a PO come together, and the
            order waits for all of them.
          </p>
        </>
      )}
    </div>
  )
}
