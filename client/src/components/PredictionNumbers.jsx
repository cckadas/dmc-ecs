import { useEffect, useState } from 'react'

import { loadAnalytics } from '../services/analyticsService'
import { WITHIN_DAYS } from '../utils/analytics'
import { count, formatDays, formatPercent } from '../utils/chartFormat'
import SimulatedBadge from './SimulatedBadge'


// =============================================================================
// The four numbers: orders on track, days from payment to shipping, supplier
// on-time rate and prediction accuracy (utils/analytics.js headlineNumbers). On
// the Predictive Analytics page, and on the Executive Dashboard, which loads its
// own (PredictionNumbersPanel).
// =============================================================================

const LABELS = ['Orders on track', 'Payment to shipping', 'Supplier on-time rate', 'Prediction accuracy']


function Tiles({ tiles, dimmed = false }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${dimmed ? 'opacity-60' : ''}`}>
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
      value: formatPercent(accuracy.withinShare),
      note: accuracy.withinShare === null
        ? `Needs ${accuracy.needed} finished orders; ${accuracy.finished} so far`
        : `of estimates within ${WITHIN_DAYS} days, tested on ${count(accuracy.tested, 'order')}`,
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
