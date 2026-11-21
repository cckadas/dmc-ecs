import { useEffect, useState } from 'react'

import { loadAnalytics } from '../services/analyticsService'
import { WITHIN_DAYS } from '../utils/analytics'
import { count, formatDays, formatPercent } from '../utils/chartFormat'
import SimulatedBadge from './SimulatedBadge'


// =============================================================================
// The four numbers: orders on track, days from payment to shipping, supplier
// on-time rate and prediction accuracy (the share of orders that shipped within
// the likely range shown) (utils/analytics.js headlineNumbers). On
// the Predictive Analytics page, and on the Executive Dashboard, which loads its
// own (PredictionNumbersPanel).
// =============================================================================

const LABELS = ['Orders on track', 'Payment to shipping', 'Supplier on-time rate', 'Prediction accuracy']


function Tiles({ tiles, dimmed = false }) {
  const columns = tiles.length === 5 ? 'xl:grid-cols-5' : tiles.length % 3 === 0 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'

  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${columns} ${dimmed ? 'opacity-60' : ''}`}>
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs text-gray-500">{tile.label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-800">{tile.value}</p>
          <p className="mt-1 text-xs text-gray-500">{tile.note}</p>
        </div>
      ))}
    </div>
  )
}


export function PredictionNumbers({ numbers, simulated = false }) {
  const { onTrack, paymentToShip, supplierOnTime, accuracy } = numbers

  const tiles = [
    {
      label: LABELS[0],
      value: onTrack.total ? `${onTrack.count} of ${onTrack.total}` : '—',
      note: onTrack.total ? 'orders under way, by their estimates' : 'No orders under way',
    },
    {
      label: LABELS[1],
      value: formatDays(paymentToShip.days),
      note: paymentToShip.orders
        ? `on average, over ${count(paymentToShip.orders, 'order')} shipped in the last 12 months`
        : 'No orders shipped in the last 12 months',
    },
    {
      label: LABELS[2],
      value: formatPercent(supplierOnTime.rate),
      note: supplierOnTime.deliveries
        ? `of ${count(supplierOnTime.deliveries, 'delivery', 'deliveries')} in the last 12 months`
        : 'No finished deliveries yet',
    },
    {
      label: LABELS[3],
      value: formatPercent(accuracy.withinRangeShare ?? null),
      note: accuracy.withinShare === null || accuracy.withinShare === undefined
        ? `Needs ${accuracy.needed} finished orders; ${accuracy.finished} so far`
        : `shipped within the likely range, tested on ${count(accuracy.tested, 'order')}; ${formatPercent(accuracy.withinShare)} within ${WITHIN_DAYS} days of the date`,
    },
  ]

  return (
    <>
      {simulated && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <SimulatedBadge />
          These numbers include the made-up demo history (orders numbered SIM-ORD-…).
        </p>
      )}

      <Tiles tiles={tiles} />
    </>
  )
}


// The numbers at the top of Predictive Analytics' Predictions tab, all about
// what's ahead (utils/analytics.js aheadNumbers). A number whose part this
// role doesn't see is left out.
export function AheadNumbers({ ahead }) {
  const { onTrack, shipSoon, lateDeliveries, demandNext, reorders, accuracy } = ahead
  const cases = (value) => `${Math.round(value).toLocaleString('en-US')} cases`
  const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })

  const tiles = [
    onTrack && {
      label: 'Orders on track',
      value: onTrack.total ? `${onTrack.count} of ${onTrack.total}` : '—',
      note: onTrack.total
        ? `orders under way expected by their requested date${onTrack.learning ? `; ${onTrack.learning} still learning` : ''}`
        : 'No orders under way with an estimate',
    },
    shipSoon && {
      label: 'Shipping soon',
      value: count(shipSoon.count, 'order'),
      note: `likely to ship in the next ${shipSoon.days / 7} weeks`,
    },
    lateDeliveries && {
      label: 'Deliveries likely late',
      value: lateDeliveries.total ? `${lateDeliveries.count} of ${lateDeliveries.total}` : '—',
      note: lateDeliveries.total
        ? `supplier deliveries still to come${lateDeliveries.overdue ? `; ${lateDeliveries.overdue} already overdue` : ''}`
        : 'No supplier deliveries still to come',
    },
    // Live: this month's forecast moves with what's been placed so far.
    demandNext && {
      label: 'Expected orders this month',
      value: `about ${cases(demandNext.cases)}`,
      note: `in ${monthName(demandNext.month)}, likely ${cases(demandNext.quick)} to ${cases(demandNext.slow)}; ${demandNext.live ? 'live, with ' : ''}${cases(demandNext.soFar ?? 0)} ordered so far`,
    },
    reorders && {
      label: 'Customers due to order',
      value: count(reorders.due, 'customer'),
      note: `due now or later than usual, by their own pace; ${reorders.soon} more expected in the next ${reorders.days / 7} weeks`,
    },
    accuracy && {
      label: 'Prediction accuracy',
      value: formatPercent(accuracy.withinRangeShare),
      note: `of tested orders shipped within their likely range (${count(accuracy.tested, 'order')})`,
    },
  ].filter(Boolean)

  return <Tiles tiles={tiles} />
}


export default function PredictionNumbersPanel() {
  const [numbers, setNumbers] = useState(null)
  const [simulated, setSimulated] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    loadAnalytics(['numbers'])
      .then((result) => {
        if (!active) return
        setNumbers(result.numbers)
        setSimulated(result.simulated)
      })
      .catch((error) => {
        console.error('Failed to load the prediction numbers:', error)
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [])

  if (failed) {
    return <p className="text-sm text-gray-500">The prediction numbers couldn't be loaded. Refresh the page to try again.</p>
  }

  if (!numbers) {
    return <Tiles dimmed tiles={LABELS.map((label) => ({ label, value: '…', note: 'Loading' }))} />
  }

  return <PredictionNumbers numbers={numbers} simulated={simulated} />
}
