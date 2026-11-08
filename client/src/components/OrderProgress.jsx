import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck } from '@fortawesome/free-solid-svg-icons'

import { ORDER_STEPS, stepsDone, stepDates } from '../utils/orderProgress'
import { loadOrderProgress } from '../services/predictionService'


const formatDate = (date) =>
  date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const formatShortDate = (date) =>
  date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

const DAY = 24 * 60 * 60 * 1000

// Each step's estimate step, whose end is when that step is reached
// (utils/predictions.js ESTIMATE_STEPS). The first step starts the order.
const ESTIMATE_STEP_FOR = [null, 'payment_check', 'ordering', 'suppliers', 'labeling', 'shipping']

// When each step not reached yet should be, from the estimate.
const expectedDates = (prediction) => ESTIMATE_STEP_FOR.map((key) => {
  const step = key && (prediction?.stepsAhead || []).find((entry) => entry.key === key)
  return step?.expectedEnd ? new Date(step.expectedEnd) : null
})

const formatPeso = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`


// =============================================
// ORDER PROGRESS
//
// Where an order is in its journey, with the date each step was reached,
// the estimated ship date and its likely range (the same estimate as the
// Executive Dashboard), and what is still owed. Needs the order's id, status,
// created_at, requested_ship_date, delivery_location_id, total_amount,
// settled_amount, pending_payment_amount, down_payment_amount and expiry_date.
// forStaff adds the confidence and the reasons, which can name suppliers.
// =============================================
export default function OrderProgress({ order, forStaff = false }) {
  const [history, setHistory] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState(null)

  useEffect(() => {
    let active = true

    loadOrderProgress(order, { forStaff })
      .then((result) => {
        if (!active) return
        setHistory(result.history)
        setPrediction(result.prediction)
        setLoadedAt(Date.now())
      })
      .catch((error) => console.error('Failed to load order progress:', error))
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [order.id, order.status, forStaff])

  const status = (order.status || '').trim().toLowerCase()
  const done = stepsDone(status)
  const dates = stepDates(order, history)
  const shipped = status === 'shipped'
  const expected = shipped ? [] : expectedDates(prediction)

  return (
    <div className="mb-6 rounded-lg border border-gray-200 p-4">
      <h3 className="mb-4 text-sm font-semibold text-gray-800">
        Order Progress
      </h3>

      {/* Steps */}
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ORDER_STEPS.map((step, index) => {
          const isDone = index < done
          const isCurrent = index === done
          const note =
            index === 1 && status === 'submitted' ? 'Payment awaiting verification'
            : index === 1 && status === 'payment rejected' ? 'Payment rejected — please pay again'
            : null

          return (
            <li key={step.label} className="flex items-start gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isDone
                    ? 'bg-[#2D5A42] text-white'
                    : isCurrent
                      ? 'border-2 border-[#2D5A42] text-[#2D5A42]'
                      : 'border border-gray-300 text-gray-400'
                }`}
              >
                {isDone ? <FontAwesomeIcon icon={faCheck} className="h-3 w-3"/> : index + 1}
              </span>

              <div className="min-w-0">
                <p className={`text-sm ${isDone || isCurrent ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                  {step.label}
                </p>

                {isDone && dates[index] && (
                  <p className="text-xs text-gray-500">{formatDate(dates[index])}</p>
                )}

                {!isDone && expected[index] && (
                  <p className="text-xs text-gray-400">Expected {formatShortDate(expected[index])}</p>
                )}

                {note && (
                  <p className={`text-xs font-medium ${status === 'payment rejected' ? 'text-red-700' : 'text-yellow-700'}`}>
                    {note}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {!loading && loadedAt && (
        <OrderTimeline dates={dates} expected={expected} done={done} prediction={prediction} shipped={shipped} now={loadedAt} />
      )}

      {/* Estimated ship date and payment */}
      <div className="mt-4 space-y-1 rounded-md bg-gray-50 p-3 text-sm">
        {shipped ? (
          <p className="text-gray-700">Shipped{dates[5] ? ` on ${formatDate(dates[5])}` : ''}.</p>
        ) : loading ? (
          <p className="text-gray-700">Estimating the ship date...</p>
        ) : prediction?.estimatedShipDate ? (
          <EstimateLines prediction={prediction} forStaff={forStaff} />
        ) : (
          <p className="text-gray-500">Estimated ship date not available yet.</p>
        )}

        <p className="text-gray-700">
          <PaymentLine order={order} />
        </p>
      </div>
    </div>
  )
}


// =============================================
// TIMELINE
//
// The order's steps on a line: done ones at their real dates (filled), the rest
// at their expected dates (outlined), numbered as in the list above. A shaded
// band shows the likely ship dates, a dashed line the date the customer asked
// for. Drawn in pixels at the card's width, so the text stays readable.
// =============================================
const TIMELINE = { height: 104, line: 52, gutter: 18 }
const INK = { primary: '#1f2937', secondary: '#6b7280', track: '#e1e0d9', step: '#2D5A42', band: '#2a78d6' }

function OrderTimeline({ dates, expected, done, prediction, shipped, now }) {
  const box = useRef(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return undefined
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const points = ORDER_STEPS.map((step, index) => {
    const at = index < done ? dates[index] : expected[index]
    return at ? { index, label: step.label, at: at.getTime(), done: index < done } : null
  }).filter(Boolean)

  if (points.length < 2) return null

  const quick = !shipped && prediction?.shipDateRange?.quick ? new Date(prediction.shipDateRange.quick).getTime() : null
  const slow = !shipped && prediction?.shipDateRange?.slow ? new Date(prediction.shipDateRange.slow).getTime() : null
  const requested = prediction?.requestedShipDate ? Date.parse(`${prediction.requestedShipDate}T12:00:00+08:00`) : null
  const last = points[points.length - 1]

  const start = Math.min(...points.map((point) => point.at))
  const end = Math.max(...points.map((point) => point.at), slow || 0, requested || 0, shipped ? 0 : now)
  const span = Math.max(end - start, DAY)
  const left = TIMELINE.gutter
  const right = Math.max(width, 280) - TIMELINE.gutter
  const x = (time) => left + ((time - start) / span) * (right - left)
  const anchor = (position) => (position < left + 40 ? 'start' : position > right - 40 ? 'end' : 'middle')

  const lastDone = [...points].reverse().find((point) => point.done)
  const summary = [
    ...points.map((point) => `${point.label} ${point.done ? '' : 'expected '}${formatShortDate(point.at)}`),
    quick && slow ? `likely ship dates ${formatShortDate(quick)} to ${formatShortDate(slow)}` : null,
    requested ? `requested ${formatShortDate(requested)}` : null,
  ].filter(Boolean).join(', ')

  return (
    <div ref={box} className="mt-4">
      {width > 0 && (
        <svg width={width} height={TIMELINE.height} role="img" aria-label={`Timeline: ${summary}`} className="block">
          {/* The likely ship dates */}
          {quick && slow && (
            <rect x={x(quick)} y={TIMELINE.line - 16} width={Math.max(x(slow) - x(quick), 3)} height={32} rx={4} fill={INK.band} fillOpacity={0.12} />
          )}

          {/* The date the customer asked for */}
          {requested && (
            <g>
              <line x1={x(requested)} x2={x(requested)} y1={20} y2={TIMELINE.line + 22} stroke={INK.secondary} strokeDasharray="4 4" />
              <text x={x(requested)} y={13} textAnchor={anchor(x(requested))} fontSize={11} fill={INK.secondary}>
                Requested {formatShortDate(requested)}
              </text>
            </g>
          )}

          {/* The line, and the part already travelled */}
          <line x1={left} x2={right} y1={TIMELINE.line} y2={TIMELINE.line} stroke={INK.track} strokeWidth={2} strokeLinecap="round" />
          {lastDone && <line x1={x(start)} x2={x(lastDone.at)} y1={TIMELINE.line} y2={TIMELINE.line} stroke={INK.step} strokeWidth={2} strokeLinecap="round" />}

          {/* Today */}
          {!shipped && now >= start && now <= end && (
            <g>
              <line x1={x(now)} x2={x(now)} y1={TIMELINE.line - 12} y2={TIMELINE.line + 12} stroke={INK.primary} strokeWidth={1} />
              <text x={x(now)} y={TIMELINE.line - 18} textAnchor={anchor(x(now))} fontSize={11} fill={INK.primary}>Today</text>
            </g>
          )}

          {/* The steps */}
          {points.map((point) => (
            <g key={point.index}>
              <title>{`${point.index + 1}. ${point.label}: ${point.done ? '' : 'expected '}${formatDate(new Date(point.at))}`}</title>
              <circle cx={x(point.at)} cy={TIMELINE.line} r={9} fill={point.done ? INK.step : '#ffffff'} stroke={INK.step} strokeWidth={2} />
              <text x={x(point.at)} y={TIMELINE.line} dominantBaseline="central" textAnchor="middle" fontSize={10} fontWeight={700} fill={point.done ? '#ffffff' : INK.step}>
                {point.index + 1}
              </text>
            </g>
          ))}

          {/* The first and last dates */}
          <text x={x(start)} y={TIMELINE.height - 4} textAnchor="start" fontSize={11} fill={INK.secondary}>{formatShortDate(start)}</text>
          <text x={x(last.at)} y={TIMELINE.height - 4} textAnchor={anchor(x(last.at)) === 'start' ? 'start' : 'end'} fontSize={11} fontWeight={600} fill={INK.primary}>
            {shipped ? 'Shipped' : last.index === ORDER_STEPS.length - 1 ? 'Ships around' : 'Expected'} {formatShortDate(last.at)}
          </text>
        </svg>
      )}

      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2D5A42]" /> Done</li>
        {!shipped && <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#2D5A42] bg-white" /> Expected</li>}
        {quick && slow && <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-[#2a78d6]/15" /> Likely ship dates</li>}
        {requested && <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-0 border-l border-dashed border-gray-500" /> Requested ship date</li>}
      </ul>
    </div>
  )
}


// The estimate: ship date, likely range, arrival, and how it compares with the
// date the customer asked for. Customers get a range and plain words; staff
// also get the confidence and the reasons, which can name suppliers.
function EstimateLines({ prediction, forStaff }) {
  const requested = prediction.requestedShipDate
    ? formatDate(new Date(`${prediction.requestedShipDate}T00:00:00`))
    : null

  let note = null
  if (prediction.daysPastRequested > 0) note = `May be later than your requested date (${requested}). DMC will contact you.`
  else if (prediction.customerNote && prediction.customerNote !== 'On track for your requested date.') note = prediction.customerNote
  else if (requested) note = `On track for your requested date (${requested}).`

  // Staff: at risk for any reason. A customer: only later than the date they
  // asked for, never why.
  const late = forStaff ? prediction.risk === 'at risk' : (prediction.daysPastRequested ?? 0) > 0

  return (
    <>
      <p className="text-gray-700">
        <span className="font-medium">
          {prediction.ifPaidToday ? 'If the down payment is made today, it ships around ' : 'Estimated ship date: '}
          {formatDate(new Date(prediction.estimatedShipDate))}
        </span>
        {prediction.shipDateRange && (
          <span className="text-gray-500">
            {' '}· likely {formatShortDate(prediction.shipDateRange.quick)} to {formatShortDate(prediction.shipDateRange.slow)}
          </span>
        )}
      </p>

      {prediction.estimatedArrivalDate && (
        <p className="text-gray-700">
          Estimated arrival at your port: {formatDate(new Date(prediction.estimatedArrivalDate))}
        </p>
      )}

      {/* Staff see the reasons; customers see them in plain words, never a supplier's name. */}
      {forStaff ? (
        <>
          {prediction.riskReasons?.map((reason) => (
            <p key={reason} className="font-medium text-red-700">{reason}</p>
          ))}
          {!late && requested && <p className="text-green-700">On track for the requested date ({requested}).</p>}
          <p className="text-xs text-gray-500">
            {prediction.confidence}% confidence{prediction.roughEstimate ? ' · rough estimate: few finished orders to learn from yet' : ''}
          </p>
        </>
      ) : (
        <>
          {note && <p className={`font-medium ${late ? 'text-amber-700' : 'text-green-700'}`}>{note}</p>}
          <p className="text-xs text-gray-500">
            An estimate from past orders and DMC's usual times, not a guaranteed date{prediction.roughEstimate ? ' (a rough one for now)' : ''}.
          </p>
        </>
      )}
    </>
  )
}


// Payment, separate from the steps: the balance can be paid at any stage.
function PaymentLine({ order }) {
  const total = Number(order.total_amount || 0)
  const settled = Number(order.settled_amount || 0)
  const pending = Number(order.pending_payment_amount || 0)
  const balance = Math.max(total - settled, 0)
  const awaiting = pending > 0 ? ` · ${formatPeso(pending)} awaiting verification` : ''

  if (total > 0 && settled >= total) {
    return <><span className="font-medium">Payment:</span> fully paid ✓</>
  }

  if (settled > 0) {
    return <><span className="font-medium">Payment:</span> down payment received ✓ · balance {formatPeso(balance)} due{awaiting}</>
  }

  let dueText = ''
  if (order.expiry_date) {
    const due = new Date(`${order.expiry_date}T00:00:00`)
    due.setDate(due.getDate() + 7)
    dueText = ` by ${formatDate(due)}`
  }

  return <><span className="font-medium">Payment:</span> down payment of {formatPeso(order.down_payment_amount)} due{dueText}{awaiting}</>
}


// =============================================
// COMPACT VERSION — one line and a bar, for lists such as the dashboard.
// =============================================
export function OrderStepsBar({ status }) {
  const done = stepsDone(status)

  return (
    <div className="mt-1">
      <div className="flex gap-0.5" aria-hidden="true">
        {ORDER_STEPS.map((step, index) => (
          <span
            key={step.label}
            className={`h-1.5 flex-1 rounded-full ${index < done ? 'bg-[#2D5A42]' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      <p className="mt-1 text-[11px] text-gray-500">
        Step {done} of {ORDER_STEPS.length}: {ORDER_STEPS[done - 1].label}
      </p>
    </div>
  )
}
