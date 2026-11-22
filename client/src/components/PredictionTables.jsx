import { Fragment, useState } from 'react'

import { DemandChart } from './AnalyticsCharts'
import { EstimateWorkingTable } from './EstimateWorking'
import ProductDeliveries from './ProductDeliveries'
import ProductTransactions from './ProductTransactions'
import TableScroll from './TableScroll'


// =============================================================================
// The predictions as lists, for Predictive Analytics' Predictions tab: each
// order under way with when it should ship and arrive, each supplier delivery
// still to come with when it should arrive, each customer with when it will
// likely order next, and sales by product with each product's expected cases
// (services/analyticsService.js loads them).
// =============================================================================

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
const shortDate = (value) => (value ? dateFormat.format(new Date(value)) : '—')
const dayFormat = (day) => (day ? dateFormat.format(new Date(`${String(day).slice(0, 10)}T12:00:00+08:00`)) : '—')
const cases = (value) => `${Math.round(value).toLocaleString('en-US')}`
const peso = (value) => `US$${Math.round(value).toLocaleString('en-US')}`

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
// track for the customer's requested date (staff see why not). Each opens how
// its date is worked out: the days every step still to come adds.
export function OrdersAheadTable({ orders }) {
  const [openId, setOpenId] = useState(null)

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
            <Fragment key={order.id}>
              <tr>
                <td className={CELL}>
                  <p className="font-medium text-gray-800">{order.orderNumber}</p>
                  {order.customer && <p className="text-xs text-gray-500">{order.customer}</p>}
                </td>
                <td className={CELL}>
                  {STEP_NOW[order.status] || order.status}
                  {order.labelNow && <p className="text-xs text-gray-500">{order.labelNow}</p>}
                </td>
                <td className={`${CELL} whitespace-nowrap`}>
                  {order.shipDate ? (
                    <>
                      <p className="font-medium text-gray-800">{shortDate(order.shipDate)}{order.ifPaidToday ? ' if paid today' : ''}</p>
                      {order.shipRange && <p className="text-xs text-gray-500">likely {shortDate(order.shipRange.quick)} to {shortDate(order.shipRange.slow)}</p>}
                      {order.working && (
                        <button
                          type="button"
                          aria-expanded={openId === order.id}
                          onClick={() => setOpenId(openId === order.id ? null : order.id)}
                          className="mt-1 text-xs font-medium text-[#2D5A42] hover:underline"
                        >
                          {openId === order.id ? 'Hide the working' : "How it's worked out"}
                        </button>
                      )}
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

              {openId === order.id && order.working && (
                <tr>
                  <td colSpan={6} className="bg-gray-50 px-4 py-3">
                    <p className="mb-1 text-sm font-semibold text-gray-800">{order.orderNumber}: how its date is worked out</p>
                    <EstimateWorkingTable working={order.working} />
                  </td>
                </tr>
              )}
            </Fragment>
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


// Each customer's next order: its usual gap between orders, when the next one
// is expected, and whether it's due or later than usual (utils/reorderTiming.js).
export function ReorderTable({ customers }) {
  if (!customers.length) return <p className="text-sm text-gray-500">No customer has ordered in the last 12 months.</p>

  const days = (value) => `${Math.round(value)} ${Math.round(value) === 1 ? 'day' : 'days'}`

  return (
    <TableScroll>
      <table className="min-w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className={HEAD}>Customer</th>
            <th className={HEAD}>Usually orders</th>
            <th className={HEAD}>Last order</th>
            <th className={HEAD}>Next order expected</th>
            <th className={HEAD}>Prediction</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {customers.map((customer) => (
            <tr key={customer.id}>
              <td className={CELL}>
                <p className="font-medium text-gray-800">{customer.name}</p>
                <p className="text-xs text-gray-500">
                  {customer.orders} {customer.orders === 1 ? 'order' : 'orders'}
                  {customer.usualCases ? ` · usually about ${cases(customer.usualCases)} cases` : ''}
                </p>
              </td>
              <td className={CELL}>
                <p className="text-gray-800">every {days(customer.usual)}</p>
                <p className="text-xs text-gray-500">
                  {customer.leansOnEveryone
                    ? "too few orders yet: going by every customer's pace"
                    : `${Math.round(customer.quick)} to ${days(customer.slow)} in its last ${customer.gaps} gaps`}
                </p>
              </td>
              <td className={`${CELL} whitespace-nowrap`}>
                <p>{dayFormat(customer.lastDay)}</p>
                {customer.lastOrderNumber && <p className="text-xs text-gray-500">{customer.lastOrderNumber}</p>}
              </td>
              <td className={`${CELL} whitespace-nowrap`}>
                <p className="font-medium text-gray-800">around {dayFormat(customer.expectedDay)}</p>
                <p className="text-xs text-gray-500">likely {dayFormat(customer.range.quick)} to {dayFormat(customer.range.slow)}</p>
              </td>
              <td className={CELL}>
                {customer.state === 'overdue' ? (
                  <>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Later than usual</span>
                    <p className="mt-1 text-xs text-gray-600">{days(customer.overdueDays)} past its likely dates</p>
                  </>
                ) : customer.state === 'due' ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-[#2D5A42]">Due now</span>
                ) : (
                  <span className="text-xs text-gray-500">In {days(customer.daysUntil)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}


// Sales by product: each product's cases (and, for showMoney, pesos) over the
// last 12 months, its trend, how often it's ordered, and its expected cases
// this month (the forecast's first month is the one under way). Choosing one
// shows its months, how its forecast comes from its sales, and its orders.
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
              <th className={HEAD}>How often</th>
              <th className={`${HEAD} text-right`}>Expected this month</th>
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
                <td className={`${CELL} text-right tabular-nums`}>{product.newThisMonth ? 'new this month' : trendText(product.trend)}</td>
                <td className={CELL}><HowOften timing={product.timing} /></td>
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

// How often a product is ordered, in a few words.
function HowOften({ timing }) {
  if (!timing) return '—'
  const times = (count) => `${count} ${count === 1 ? 'order' : 'orders'}`
  if (!timing.orders) return <span className="text-gray-500">not in 12 months</span>

  return (
    <>
      <p className="whitespace-nowrap text-gray-800">{timing.usual === null ? times(timing.orders) : `every ${Math.round(timing.usual)} days`}</p>
      {timing.usual !== null && <p className="whitespace-nowrap text-xs text-gray-500">{times(timing.orders)} in 12 months</p>}
    </>
  )
}


// The last 3 months against the 3 before.
function trendText(trend) {
  if (trend === null || trend === undefined) return 'new'
  const percent = Math.round(trend * 100)
  if (percent === 0) return 'same as before'
  return percent > 0 ? `up ${percent}%` : `down ${-percent}%`
}


// One product: its months, its forecast, how its sales make that forecast, its
// orders and its deliveries.
function ProductDetail({ product, showMoney }) {
  const next = product.forecast?.[0]
  const sharePercent = Math.round(product.share * 1000) / 10
  // This month is live: the forecast made before it (its share of its
  // category's), moved by the product's own cases placed so far.
  const before = next?.before || next
  // Every record it's on, in a window (as on the Products page).
  const [showTransactions, setShowTransactions] = useState(false)

  let forecastText = 'Not ordered in the last 6 months, so it has no share of its category to forecast from.'
  if (next && product.share > 0) {
    forecastText = `How its sales make its forecast: over the last 6 months it was ${sharePercent}% of the ${product.category} cases ordered. From past months, ${product.category} was expected to order about ${cases(before.cases / product.share)} cases this month, so about ${cases(before.cases)} of this product.`
    forecastText += next.live
      ? ` That figure is live: ${cases(next.placed)} cases of it have been placed so far, and usually ${Math.round(next.gone * 100)}% of a month's cases are placed by now, which makes it about ${cases(next.cases)} (likely ${cases(next.quick)} to ${cases(next.slow)}).`
      : ` Likely ${cases(next.quick)} to ${cases(next.slow)}.`
    forecastText += " The more it sells, the bigger its share, and the more it's expected to sell."
  } else if (product.newThisMonth) {
    forecastText = 'First ordered this month, so it has no full month of sales to forecast from yet.'
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-800">{product.name || 'A product'}</p>
          <p className="text-xs text-gray-500">
            {product.category} · {cases(product.cases)} cases in the last 12 months{showMoney ? ` · ${peso(product.amount)} in sales` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowTransactions(true)}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-[#B8D5C3] hover:text-[#2D5A42]"
        >
          Every transaction with it
        </button>
      </div>

      {showTransactions && (
        <ProductTransactions productId={product.id} name={product.name} onClose={() => setShowTransactions(false)} />
      )}

      <div className="mt-3">
        <DemandChart history={product.monthly} forecast={product.share > 0 ? product.forecast : null} />
      </div>

      <p className="mt-2 text-sm text-gray-700">{forecastText}</p>

      {product.timing && <ProductOrders timing={product.timing} />}

      {/* Every time it came in, read when the product is chosen. */}
      <ProductDeliveries key={product.id} productId={product.id} />
    </div>
  )
}


const STATE_TEXT = { overdue: 'later than usual', due: 'due now', soon: 'soon', later: 'later' }

// A product's orders, newest first; how often it's ordered (the days between
// the days it's in an order over the last 12 months); and who orders it, with
// when each of them is likely to order next (Customers likely to order next).
function ProductOrders({ timing }) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? timing.list : timing.list.slice(0, 8)
  const days = (value) => `${Math.round(value)} ${Math.round(value) === 1 ? 'day' : 'days'}`
  const count = (number, one, many = `${one}s`) => `${number} ${number === 1 ? one : many}`

  let often = `Not ordered in the last 12 months; last ordered ${dayFormat(timing.lastDay)}.`
  if (timing.orders) {
    often = `In ${count(timing.orders, 'order')} from ${count(timing.customers, 'customer')} in the last 12 months, ${cases(timing.cases)} cases in all.`
    if (timing.usual !== null) {
      often += ` Usually a new order of it every ${days(timing.usual)} (most gaps between ${days(timing.quick)} and ${days(timing.slow)}).`
    }
    often += ` Last ordered ${dayFormat(timing.lastDay)}.`
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="text-sm font-semibold text-gray-800">How often it's ordered</p>
      <p className="mt-1 text-sm text-gray-700">{often}</p>
      {timing.thisMonth.orders > 0 && (
        <p className="text-sm text-gray-700">This month so far: {cases(timing.thisMonth.cases)} cases in {count(timing.thisMonth.orders, 'order')}.</p>
      )}

      {timing.buyers?.length > 0 && (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Who orders it</p>
          <TableScroll className="mt-1">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className={HEAD}>Customer</th>
                  <th className={HEAD}>In its orders</th>
                  <th className={HEAD}>Last ordered it</th>
                  <th className={HEAD}>Its next order expected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {timing.buyers.map((buyer) => (
                  <tr key={buyer.customerId}>
                    <td className={CELL}>{buyer.customer || 'A customer'}</td>
                    <td className={`${CELL} whitespace-nowrap`}>{buyer.orders} of {buyer.ofOrders} in 12 months</td>
                    <td className={`${CELL} whitespace-nowrap`}>{dayFormat(buyer.lastDay)}</td>
                    <td className={`${CELL} whitespace-nowrap`}>
                      {buyer.nextOrder
                        ? <>around {dayFormat(buyer.nextOrder.expectedDay)}{STATE_TEXT[buyer.nextOrder.state] ? <span className="text-xs text-gray-500"> · {STATE_TEXT[buyer.nextOrder.state]}</span> : null}</>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Its orders, newest first</p>
      <TableScroll className="mt-1">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className={HEAD}>Ordered</th>
              <th className={HEAD}>Order</th>
              <th className={HEAD}>Customer</th>
              <th className={`${HEAD} text-right`}>Cases</th>
              <th className={HEAD}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((line) => (
              <tr key={line.orderId}>
                <td className={`${CELL} whitespace-nowrap`}>{dayFormat(line.day)}</td>
                <td className={`${CELL} whitespace-nowrap`}>{line.orderNumber || '—'}</td>
                <td className={CELL}>{line.customer || '—'}</td>
                <td className={`${CELL} text-right tabular-nums`}>{cases(line.cases)}</td>
                <td className={CELL}>{line.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {timing.list.length > 8 && (
        <button type="button" onClick={() => setShowAll((all) => !all)} className="mt-2 text-sm font-medium text-[#2D5A42] hover:underline">
          {showAll ? 'Show the latest 8' : `Show all ${timing.list.length} orders`}
        </button>
      )}
    </div>
  )
}
