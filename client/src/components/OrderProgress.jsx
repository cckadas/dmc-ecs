import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck } from '@fortawesome/free-solid-svg-icons'

import { ORDER_STEPS, stepsDone, stepDates } from '../utils/orderProgress'
import { loadOrderProgress } from '../services/predictionService'


const formatDate = (date) =>
  date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const formatShortDate = (date) =>
  date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

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

  useEffect(() => {
    let active = true

    loadOrderProgress(order, { forStaff })
      .then((result) => {
        if (!active) return
        setHistory(result.history)
        setPrediction(result.prediction)
      })
      .catch((error) => console.error('Failed to load order progress:', error))
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [order.id, order.status, forStaff])

  const status = (order.status || '').trim().toLowerCase()
  const done = stepsDone(status)
  const dates = stepDates(order, history)
  const shipped = status === 'shipped'

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

  // From the server a customer's estimate says only whether it's late, not why.
  const late = prediction.late ?? prediction.risk === 'at risk'

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
