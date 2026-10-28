import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck } from '@fortawesome/free-solid-svg-icons'

import { ORDER_STEPS, stepsDone, stepDates } from '../utils/orderProgress'
import { loadOrderProgress } from '../services/predictionService'


const formatDate = (date) =>
  date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const formatPeso = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`


// =============================================
// ORDER PROGRESS
//
// Where an order is in its journey, with the date each step was reached,
// the predicted ready date (the same estimate as the Executive Dashboard),
// and what is still owed. Needs the order's id, status, created_at,
// estimated_ship_date, total_amount, settled_amount, pending_payment_amount,
// down_payment_amount and expiry_date.
// =============================================
export default function OrderProgress({ order }) {
  const [history, setHistory] = useState([])
  const [prediction, setPrediction] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    loadOrderProgress(order)
      .then((result) => {
        if (!active) return
        setHistory(result.history)
        setPrediction(result.prediction)
      })
      .catch((error) => console.error('Failed to load order progress:', error))
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [order.id, order.status])

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

      {/* Estimated ready date and payment */}
      <div className="mt-4 space-y-1 rounded-md bg-gray-50 p-3 text-sm">
        <p className="text-gray-700">
          {shipped ? (
            <>Shipped{dates[5] ? ` on ${formatDate(dates[5])}` : ''}.</>
          ) : loading ? (
            'Estimating ready date...'
          ) : prediction?.estimatedReadyDate ? (
            <>
              <span className="font-medium">Estimated ready for shipment: {formatDate(new Date(prediction.estimatedReadyDate))}</span>
              <span className="text-gray-500"> · an estimate from past orders ({prediction.confidence}% confidence)</span>
            </>
          ) : (
            <span className="text-gray-500">Estimated ready date not available yet.</span>
          )}
        </p>

        <p className="text-gray-700">
          <PaymentLine order={order} />
        </p>
      </div>
    </div>
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
