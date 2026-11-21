import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../context/AuthContext'
import { READS_QUOTATIONS, loadProductSizes, loadProductTransactions } from '../services/productTransactionService'
import { formatDateTime } from '../utils/dates'
import TableScroll from './TableScroll'


// =============================================================================
// A product's transactions: a window listing every record the product is on —
// quotation requests, quotations, customer orders, and purchase orders with
// each time their goods were received — with totals (utils/productTransactions.js).
// Opened from the Products page and from a product under Sales by product.
//
// It only shows what's on record. Staff only: it names customers and
// suppliers. Quotation requests and quotations show for the roles that can read
// them (sales and admin).
// =============================================================================

const HEAD = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500'
const CELL = 'px-4 py-2.5 align-top text-sm text-gray-700'
const SHOWN = 8

const count = (value) => Math.round(value).toLocaleString('en-US')
const statusText = (status) => {
  const text = String(status || '').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—'
}
// A YYYY-MM-DD day, e.g. "Nov 23, 2026".
const dayText = (day) => (day
  ? new Date(`${String(day).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : '—')


// One list of rows, the latest few first, with the rest behind a link.
function Section({ title, rows, empty, columns }) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? rows : rows.slice(0, SHOWN)

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-800">
        {title} <span className="font-normal text-gray-500">({rows.length})</span>
      </h3>

      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-gray-500">{empty}</p>
      ) : (
        <>
          <TableScroll className="mt-2 rounded-lg border border-gray-200">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  {columns.map((column) => (
                    <th key={column.label} className={`${HEAD} ${column.numeric ? 'text-right' : ''}`}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((row) => (
                  <tr key={row.id}>
                    {columns.map((column) => (
                      <td key={column.label} className={`${CELL} ${column.numeric ? 'text-right tabular-nums' : ''} ${column.wrap ? '' : 'whitespace-nowrap'}`}>
                        {column.value(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          {rows.length > SHOWN && (
            <button type="button" onClick={() => setShowAll((all) => !all)} className="mt-2 text-sm font-medium text-[#2D5A42] hover:underline">
              {showAll ? `Show the latest ${SHOWN}` : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}


// Each time a PO line's goods came in, oldest first.
function Receivings({ row }) {
  if (!row.receivings.length) return <span className="text-gray-400">None yet</span>

  return row.receivings.map((entry) => (
    <p key={entry.id} className="whitespace-nowrap">
      {formatDateTime(entry.at)}:{' '}
      {entry.kind === 'correction'
        ? `count corrected to ${count(entry.soFar)}`
        : `${count(entry.cases)}${entry.kind === 'part' ? ` (${count(entry.soFar)} of ${count(row.cases)} so far)` : ''}`}
      {entry.test && <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Test run</span>}
    </p>
  ))
}


// productId: the product (one pack size) to look up. name: shown while it loads.
export default function ProductTransactions({ productId, name = '', onClose }) {
  const { profile } = useAuth()
  const seesQuotations = READS_QUOTATIONS.includes(profile?.role?.toLowerCase())

  const [found, setFound] = useState(null)       // { product, sizes }
  const [allSizes, setAllSizes] = useState(false)
  const [state, setState] = useState({ key: null, data: null, failed: false })

  // The product and the other sizes of its family.
  useEffect(() => {
    let active = true

    loadProductSizes(productId)
      .then((result) => { if (active) setFound(result || { product: null, sizes: [] }) })
      .catch((error) => {
        console.error('Failed to load the product:', error)
        if (active) setFound({ product: null, sizes: [], failed: true })
      })

    return () => { active = false }
  }, [productId])

  // Its transactions: this size's, or every size's.
  const looked = found?.product ? (allSizes ? found.sizes : [found.product]) : null
  const key = looked ? looked.map((product) => product.id).join(',') : null

  useEffect(() => {
    if (!looked) return undefined
    let active = true

    loadProductTransactions(looked, { quotations: seesQuotations })
      .then((data) => { if (active) setState({ key, data, failed: false }) })
      .catch((error) => {
        console.error("Failed to load the product's transactions:", error)
        if (active) setState({ key, data: null, failed: true })
      })

    return () => { active = false }
    // `key` stands for `looked`: the same products, whatever the array.
  }, [key, seesQuotations])

  const product = found?.product
  const others = found ? found.sizes.length - 1 : 0
  const loading = !found || (looked && state.key !== key)
  const data = loading ? null : state.data
  const title = product ? (product.family || product.product_name) : name || 'Product'

  // With several sizes looked up, each row says which size it is.
  const sizeColumn = allSizes && others > 0 ? [{ label: 'Size', value: (row) => row.size || '—' }] : []
  const casesColumn = { label: 'Cases', numeric: true, value: (row) => count(row.cases) }
  const statusColumn = { label: 'Status', value: (row) => statusText(row.status) }
  const customerColumn = { label: 'Customer', wrap: true, value: (row) => row.customer || '—' }

  const many = (number, one, plural = `${one}s`) => `${number} ${number === 1 ? one : plural}`
  const ordersCounted = data ? data.orders.filter((order) => !order.cancelled).length : 0
  const pos = data ? new Set(data.purchaseOrders.map((row) => row.number)).size : 0

  const tiles = data ? [
    ...(seesQuotations ? [
      { label: 'Requested', value: data.totals.requested, note: `in ${many(data.requests.length, 'quotation request')}` },
      { label: 'Quoted', value: data.totals.quoted, note: `in ${many(data.quotations.length, 'quotation')}` },
    ] : []),
    { label: 'Ordered', value: data.totals.ordered, note: `in ${many(ordersCounted, 'customer order')}` },
    { label: 'Purchased', value: data.totals.purchased, note: `on ${many(pos, 'PO')}` },
    { label: 'Received', value: data.totals.received, note: 'into the warehouse' },
    { label: 'Still to come', value: data.totals.toCome, note: 'purchased, not received yet' },
  ] : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b bg-[#F4F8F5] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">{title}</h2>
            <p className="text-sm text-gray-500">
              {product
                ? [allSizes && others > 0 ? `All ${found.sizes.length} sizes` : product.pack_size, product.brand, product.category].filter(Boolean).join(' · ')
                : 'Every transaction this product is in.'}
            </p>
          </div>

          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-gray-500 transition hover:bg-white hover:text-gray-700">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-gray-600">
            Every record this product is on, as saved in the system: what was asked for, quoted, ordered, bought from
            suppliers and received.
          </p>

          {others > 0 && (
            <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={allSizes} onChange={(event) => setAllSizes(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              Include its other {others === 1 ? 'size' : `${others} sizes`} ({found.sizes.filter((size) => size.id !== product.id).map((size) => size.pack_size || size.product_name).join(', ')})
            </label>
          )}

          {loading ? (
            <p className="mt-4 text-sm text-gray-500">Loading its transactions…</p>
          ) : !product ? (
            <p className="mt-4 text-sm text-gray-500">{found.failed ? "The product couldn't be loaded. Close this and try again." : "This product isn't in the catalog any more."}</p>
          ) : state.failed ? (
            <p className="mt-4 text-sm text-gray-500">Its transactions couldn't be loaded. Close this and try again.</p>
          ) : (
            <>
              {/* Totals, in cases */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {tiles.map((tile) => (
                  <div key={tile.label} className="rounded-lg border border-gray-200 px-3 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{tile.label}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-800">{count(tile.value)} <span className="text-sm font-normal text-gray-500">cases</span></p>
                    <p className="text-xs text-gray-500">{tile.note}</p>
                  </div>
                ))}
              </div>

              {seesQuotations && (
                <>
                  <Section
                    title="Quotation requests"
                    rows={data.requests}
                    empty="No quotation request has asked for it."
                    columns={[
                      { label: 'Requested', value: (row) => formatDateTime(row.at) },
                      { label: 'Reference', value: (row) => row.number || '—' },
                      customerColumn, ...sizeColumn, casesColumn, statusColumn,
                    ]}
                  />

                  <Section
                    title="Quotations"
                    rows={data.quotations}
                    empty="No quotation has included it."
                    columns={[
                      { label: 'Made', value: (row) => formatDateTime(row.at) },
                      { label: 'Quotation', value: (row) => row.number || '—' },
                      customerColumn, ...sizeColumn, casesColumn, statusColumn,
                    ]}
                  />
                </>
              )}

              <Section
                title="Customer orders"
                rows={data.orders}
                empty="No customer order has included it."
                columns={[
                  { label: 'Placed', value: (row) => formatDateTime(row.at) },
                  { label: 'Order', value: (row) => row.number || '—' },
                  customerColumn, ...sizeColumn, casesColumn, statusColumn,
                ]}
              />

              <Section
                title="Purchase orders"
                rows={data.purchaseOrders}
                empty="No purchase order has included it."
                columns={[
                  { label: 'Made', value: (row) => formatDateTime(row.at) },
                  { label: 'PO', value: (row) => row.number || '—' },
                  { label: 'Supplier', wrap: true, value: (row) => row.supplier || '—' },
                  { label: 'For order', value: (row) => row.forOrder || '—' },
                  ...sizeColumn,
                  casesColumn,
                  { label: 'Received', wrap: true, value: (row) => <Receivings row={row} /> },
                  { label: 'Promised', value: (row) => dayText(row.promised) },
                  statusColumn,
                ]}
              />

              <p className="mt-5 text-xs text-gray-500">
                One row for each line the product is on. A cancelled order is listed but not counted in Ordered.
                {!seesQuotations && ' Quotation requests and quotations are open to sales and admin only, so they aren\'t listed here.'}
                {data.purchaseOrders.some((row) => row.receivings.some((entry) => entry.test)) && ' Test run: received within a day of its PO.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
