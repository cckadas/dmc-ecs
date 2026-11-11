import { useState } from 'react'

import { DemandChart } from './AnalyticsCharts'
import TableScroll from './TableScroll'


// =============================================================================
// The predictions as lists, for Predictive Analytics' Predictions tab: each
// order under way with when it should ship and arrive, each supplier delivery
// still to come with when it should arrive, and sales by product with each
// product's expected cases (services/analyticsService.js loads them).
// =============================================================================

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
const shortDate = (value) => (value ? dateFormat.format(new Date(value)) : '—')
const dayFormat = (day) => (day ? dateFormat.format(new Date(`${String(day).slice(0, 10)}T12:00:00+08:00`)) : '—')
const cases = (value) => `${Math.round(value).toLocaleString('en-US')}`
const peso = (value) => `₱${Math.round(value).toLocaleString('en-US')}`

// Where an order is now, in words.
const STEP_NOW = {
  'pending payment': 'Waiting for its down payment',
  'payment rejected': 'Waiting for its down payment',
  submitted: 'Payment check',
  'payment verified': 'Ordering from suppliers',
  procurement: 'Supplier deliveries',
  'warehouse preparation': 'Labeling',
  'ready for shipment': 'Ready to ship',
}

const HEAD = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500'
const CELL = 'px-4 py-2.5 align-top text-sm text-gray-700'


// Each order under way: when it should ship and arrive, and whether it's on
// track for the customer's requested date (staff see why not).
export function OrdersAheadTable({ orders }) {
  if (!orders.length) return <p className="text-sm text-gray-500">No orders under way.</p>

  return (
    <TableScroll>
      <table className="min-w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className={HEAD}>Order</th>
            <th className={HEAD}>Now</th>
            <th className={HEAD}>Ships around</th>
            <th className={HEAD}>Arrives around</th>
            <th className={HEAD}>Requested</th>
            <th className={HEAD}>Prediction</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.map((order) => (
            <tr key={order.id}>
              <td className={CELL}>
                <p className="font-medium text-gray-800">{order.orderNumber}</p>
                {order.customer && <p className="text-xs text-gray-500">{order.customer}</p>}
              </td>
              <td className={CELL}>{STEP_NOW[order.status] || order.status}</td>
              <td className={`${CELL} whitespace-nowrap`}>
                {order.shipDate ? (
                  <>
                    <p className="font-medium text-gray-800">{shortDate(order.shipDate)}{order.ifPaidToday ? ' if paid today' : ''}</p>
                    {order.shipRange && <p className="text-xs text-gray-500">likely {shortDate(order.shipRange.quick)} to {shortDate(order.shipRange.slow)}</p>}
                  </>
                ) : '—'}
              </td>
              <td className={`${CELL} whitespace-nowrap`}>{order.arrival ? shortDate(order.arrival) : '—'}</td>
              <td className={`${CELL} whitespace-nowrap`}>{dayFormat(order.requested)}</td>
              <td className={CELL}>
                {order.learning ? (
                  <span className="text-gray-500">{order.learning}</span>
                ) : order.risk === 'at risk' ? (
                  <>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">At risk</span>
                    {order.reasons.map((reason) => <p key={reason} className="mt-1 text-xs text-gray-600">{reason}</p>)}
                  </>
                ) : (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-[#2D5A42]">On track</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}


// Each supplier delivery still to come: when it should arrive, and whether
// it's overdue or likely late.
export function DeliveriesAheadTable({ deliveries }) {
  if (!deliveries.length) return <p className="text-sm text-gray-500">No supplier deliveries still to come.</p>

  return (
    <TableScroll>
      <table className="min-w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className={HEAD}>PO</th>
            <th className={HEAD}>Supplier</th>
            <th className={HEAD}>Promised</th>
            <th className={HEAD}>Expected around</th>
            <th className={HEAD}>Prediction</th>
            <th className={`${HEAD} text-right`}>Cases to come</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {deliveries.map((delivery) => (
            <tr key={`${delivery.purchaseOrderId}:${delivery.supplierId}`}>
              <td className={`${CELL} whitespace-nowrap font-medium text-gray-800`}>{delivery.poNumber || '—'}</td>
              <td className={CELL}>{delivery.supplierName}</td>
              <td className={`${CELL} whitespace-nowrap`}>{dayFormat(delivery.promised)}</td>
              <td className={`${CELL} whitespace-nowrap font-medium text-gray-800`}>{dayFormat(delivery.expectedDay)}</td>
              <td className={CELL}>
                {delivery.overdueDays > 0 ? (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{delivery.overdueDays} {delivery.overdueDays === 1 ? 'day' : 'days'} overdue</span>
                ) : delivery.likelyLate ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Likely late</span>
                ) : (
                  <span className="text-xs text-gray-500">Expected on time</span>
                )}
              </td>
              <td className={`${CELL} text-right tabular-nums`}>{cases(delivery.cases)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}


// Sales by product: each product's cases (and, for showMoney, pesos) over the
// last 12 months, its trend, and its expected cases next month. Choosing one
// shows its months and how its forecast comes from its sales.
export function ProductSales({ sales, showMoney = false }) {
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [chosenId, setChosenId] = useState(sales[0]?.id || null)

  const term = search.trim().toLowerCase()
  const matching = term
    ? sales.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(term))
    : sales
  const listed = showAll || term ? matching : matching.slice(0, 10)
  const chosen = sales.find((product) => product.id === chosenId) || null

  if (!sales.length) return <p className="text-sm text-gray-500">No sales recorded in the last 12 months.</p>

  return (
    <div>
      {chosen && <ProductDetail product={chosen} showMoney={showMoney} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a product"
          aria-label="Find a product"
          className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <p className="text-xs text-gray-500">Choose a product to see its months and its forecast.</p>
      </div>

      <TableScroll className="mt-2">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className={HEAD}>Product</th>
              <th className={`${HEAD} text-right`}>Cases, 12 months</th>
              {showMoney && <th className={`${HEAD} text-right`}>Sales, 12 months</th>}
              <th className={`${HEAD} text-right`}>Last 3 months</th>
              <th className={`${HEAD} text-right`}>Expected next month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listed.map((product) => (
              <tr key={product.id} className={product.id === chosenId ? 'bg-[#F4F8F5]' : 'hover:bg-gray-50'}>
                <td className={CELL}>
                  <button type="button" onClick={() => setChosenId(product.id)} className="text-left font-medium text-[#2D5A42] hover:underline">
                    {product.name || 'A product'}
                  </button>
                  <p className="text-xs text-gray-500">{product.category}</p>
                </td>
                <td className={`${CELL} text-right tabular-nums`}>{cases(product.cases)}</td>
                {showMoney && <td className={`${CELL} text-right tabular-nums`}>{peso(product.amount)}</td>}
                <td className={`${CELL} text-right tabular-nums`}>{trendText(product.trend)}</td>
                <td className={`${CELL} text-right tabular-nums`}>
                  {product.forecast && product.share > 0 ? `about ${cases(product.forecast[0].cases)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {!term && matching.length > 10 && (
        <button type="button" onClick={() => setShowAll((all) => !all)} className="mt-2 text-sm font-medium text-[#2D5A42] hover:underline">
          {showAll ? 'Show the top 10' : `Show all ${matching.length} products`}
        </button>
      )}
      {term && !matching.length && <p className="mt-2 text-sm text-gray-500">No product matches "{search}".</p>}
    </div>
  )
}

// The last 3 months against the 3 before.
function trendText(trend) {
  if (trend === null || trend === undefined) return 'new'
  const percent = Math.round(trend * 100)
  if (percent === 0) return 'same as before'
  return percent > 0 ? `up ${percent}%` : `down ${-percent}%`
}


// One product: its months, its forecast, and how its sales make that forecast.
function ProductDetail({ product, showMoney }) {
  const next = product.forecast?.[0]
  const sharePercent = Math.round(product.share * 1000) / 10

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-sm font-semibold text-gray-800">{product.name || 'A product'}</p>
      <p className="text-xs text-gray-500">
        {product.category} · {cases(product.cases)} cases in the last 12 months{showMoney ? ` · ${peso(product.amount)} in sales` : ''}
      </p>

      <div className="mt-3">
        <DemandChart history={product.monthly} forecast={product.share > 0 ? product.forecast : null} />
      </div>

      <p className="mt-2 text-sm text-gray-700">
        {next && product.share > 0
          ? `How its sales make its forecast: over the last 6 months it was ${sharePercent}% of the ${product.category} cases ordered. ${product.category} is expected to order about ${cases(next.cases / product.share)} cases next month, so about ${cases(next.cases)} of this product (likely ${cases(next.quick)} to ${cases(next.slow)}). The more it sells, the bigger its share, and the more it's expected to sell.`
          : 'Not ordered in the last 6 months, so it has no share of its category to forecast from.'}
      </p>
    </div>
  )
}
