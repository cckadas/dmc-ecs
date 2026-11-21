import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTruckFast, faXmark } from '@fortawesome/free-solid-svg-icons'

import { useToast } from '../context/ToastContext'
import { formatDateTime } from '../utils/dates'
import { agreeRushShipment, countOf, deadlineText, loadRushPreview, stillToShip, waitingState } from '../services/rushService'


// =============================================================================
// Rush shipment (db/migrations/034)
//
// RushShipmentModal: the customer asks for what's in DMC's warehouse to ship
// now. They see what ships and what waits, and the words they agree to, and
// agree (ticking that they read it) or keep waiting. Only the database decides:
// it refuses if anything changed since the window opened.
// RushAgreement: the agreement as recorded, and where the waiting goods are now.
// WaitingGoods: the goods waiting for a customer's next order, with counts.
// =============================================================================

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const productText = (line) => `${line.product}${line.pack_size ? ` (${line.pack_size})` : ''}`


// A list of products and their cases.
function CaseList({ title, lines, count, tone, empty }) {
  const tones = {
    ships: 'border-green-200 bg-green-50 text-green-900',
    waits: 'border-amber-200 bg-amber-50 text-amber-900',
  }

  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <p className="text-sm font-semibold">
        {title} <span className="font-normal">· {plural(count, 'case')}</span>
      </p>

      {lines.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {lines.map((line) => (
            <li key={line.key} className="flex justify-between gap-3">
              <span className="min-w-0">
                {line.label}
                {line.note && <span className="block text-xs opacity-80">{line.note}</span>}
              </span>
              <span className="shrink-0 font-medium">{line.cases.toLocaleString()} {line.unit}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm opacity-80">{empty}</p>
      )}
    </div>
  )
}

// The split, from a preview or an agreement: what ships now, what waits.
function splitLists(lines = []) {
  const ships = []
  const waits = []
  for (const line of lines) {
    const unit = line.unit || 'cases'
    const note = line.carried_from ? `From ${line.carried_from}` : null
    if (Number(line.ships_now) > 0) ships.push({ key: `${line.item_id}:now`, label: productText(line), cases: Number(line.ships_now), unit, note })
    if (Number(line.waits) > 0) waits.push({ key: `${line.item_id}:waits`, label: productText(line), cases: Number(line.waits), unit, note })
  }
  return { ships, waits }
}


// =============================================
// ASKING FOR A RUSH SHIPMENT (the customer)
// =============================================
export function RushShipmentModal({ order, onClose, onAgreed }) {
  const { toast } = useToast()
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [changed, setChanged] = useState(false)
  const [readIt, setReadIt] = useState(false)
  const [saving, setSaving] = useState(false)
  const [looks, setLooks] = useState(0)

  // What the database says would ship now. Looking again starts over: the tick
  // is cleared, so the customer agrees only to what they see.
  useEffect(() => {
    let active = true
    setLoading(true)
    setProblem('')
    setChanged(false)
    setReadIt(false)

    loadRushPreview(order.id)
      .then((data) => { if (active) setPreview(data) })
      .catch((error) => {
        if (!active) return
        setPreview(null)
        setProblem(error.message)
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [order.id, looks])

  function keepWaiting() {
    if (saving) return
    toast.info(`Nothing changed: ${order.order_number} keeps waiting until all its goods are in.`)
    onClose()
  }

  async function agree() {
    if (!preview || !readIt || saving) return

    setSaving(true)
    setChanged(false)
    try {
      const result = await agreeRushShipment(order.id, preview.fingerprint)
      toast.success(`Rush shipment agreed for ${order.order_number}: ${plural(Number(result?.cases_now || 0), 'case')} ship now, and ${plural(Number(result?.cases_waiting || 0), 'case')} go with your next order.`)
      await onAgreed?.()
      onClose()
    } catch (error) {
      setChanged(Boolean(error.changed))
      setProblem(error.message)
      setReadIt(false)
    } finally {
      setSaving(false)
    }
  }

  const { ships, waits } = splitLists(preview?.lines)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              <FontAwesomeIcon icon={faTruckFast} className="mr-2 text-[#2D5A42]" />
              Rush shipment
            </h2>
            <p className="text-sm text-gray-500">{order.order_number}</p>
          </div>

          <button type="button" onClick={keepWaiting} disabled={saving} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="Close and keep waiting">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 text-sm">
          {loading ? (
            <p className="text-gray-500">Checking what is in DMC's warehouse...</p>
          ) : !preview ? (
            <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-gray-700">{problem}</p>
          ) : (
            <>
              <p className="text-gray-700">
                Some of {order.order_number}'s goods are already in DMC's warehouse and the rest are still on their way.
                You can have what's here shipped now. Read what that means below, then agree, or keep waiting for everything to ship together.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <CaseList title="Ships now" lines={ships} count={Number(preview.cases_now || 0)} tone="ships" empty="Nothing." />
                <CaseList title="Waits for your next order" lines={waits} count={Number(preview.cases_waiting || 0)} tone="waits" empty="Nothing." />
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <p className="mb-2 font-semibold text-gray-800">What you agree to</p>
                <p className="whitespace-pre-line text-gray-700">{preview.terms}</p>
              </div>

              {problem && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                  <p>{problem}</p>
                  {changed && (
                    <button type="button" onClick={() => setLooks((count) => count + 1)} className="mt-2 font-medium text-red-900 underline">
                      Look again
                    </button>
                  )}
                </div>
              )}

              <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <input
                  type="checkbox"
                  checked={readIt}
                  onChange={(event) => setReadIt(event.target.checked)}
                  disabled={saving || changed}
                  className="mt-0.5 h-4 w-4 accent-[#2D5A42]"
                />
                <span className="text-gray-800">
                  I have read the above. Only the goods under "Ships now" go in {order.order_number}'s container; the goods under
                  "Waits for your next order" go in the container of my next order with DMC, whenever I place it.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={keepWaiting}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Keep waiting
          </button>

          {preview && (
            <button
              type="button"
              onClick={agree}
              disabled={!readIt || saving || changed}
              className="rounded-md bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
            >
              {saving ? 'Agreeing...' : 'Agree and ship what\'s in'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


// =============================================
// THE AGREEMENT, AS RECORDED (customer and DMC)
// =============================================
// waiting: waiting_goods rows of this order (where its waiting goods are now).
export function RushAgreement({ agreement, waiting = [], forStaff = false }) {
  if (!agreement) return null

  const { ships, waits } = splitLists(agreement.lines)
  const next = forStaff ? "the customer's next order" : 'your next order'
  const stateText = (row) => {
    const state = waitingState(row)
    if (state === 'given') return `DMC's since ${formatDateTime(row.given_at)} (no approved order within 2 weeks)`
    if (state === 'left') return `Left with ${row.carried_into}`
    if (state === 'joined') return `Goes with ${row.carried_into}`
    return deadlineText(row) ? `Waits for ${next}, approved by ${deadlineText(row)}` : `Waits for ${next}`
  }

  return (
    <div className="mb-6 rounded-lg border border-lime-200 bg-lime-50/50 p-4">
      <h3 className="text-sm font-semibold text-gray-800">
        <FontAwesomeIcon icon={faTruckFast} className="mr-2 text-[#2D5A42]" />
        Rush shipment agreed
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        {forStaff ? 'The customer' : 'You'} agreed on {formatDateTime(agreement.agreed_at)}
        {agreement.agreed_by_name ? ` (${agreement.agreed_by_name})` : ''}. Recorded by the system; it can't be changed or undone.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <CaseList title="Shipped with this order" lines={ships} count={Number(agreement.cases_now || 0)} tone="ships" empty="Nothing." />
        <CaseList title={`Waiting for ${next}`} lines={waits} count={Number(agreement.cases_waiting || 0)} tone="waits" empty="Nothing." />
      </div>

      {waiting.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">The waiting goods now</p>
          <ul className="mt-1 space-y-1 text-sm text-gray-700">
            {waiting.map((row) => (
              <li key={row.item_id} className="flex flex-wrap justify-between gap-2">
                <span>{row.product_name}{row.pack_size ? ` (${row.pack_size})` : ''} · {Number(row.cases).toLocaleString()} {row.unit || 'cases'}</span>
                <span className="font-medium">{stateText(row)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-[#2D5A42]">The words agreed to</summary>
        <p className="mt-2 whitespace-pre-line rounded-md border border-gray-200 bg-white p-3 text-gray-700">{agreement.terms}</p>
      </details>
    </div>
  )
}


// =============================================
// GOODS WAITING FOR A NEXT ORDER (counts, both ends)
// =============================================
// rows: waiting_goods rows (any of a customer's, or every customer's for
// staff, with customer_id); customerName(id) for staff.
export function WaitingGoods({ rows, forStaff = false, customerName = null }) {
  const [open, setOpen] = useState(false)
  const toShip = stillToShip(rows)
  if (!toShip.length) return null

  const total = countOf(toShip)
  const waiting = toShip.filter((row) => waitingState(row) === 'waiting')
  const joined = toShip.filter((row) => waitingState(row) === 'joined')
  const customers = new Set(toShip.map((row) => row.customer_id).filter(Boolean)).size
  // The soonest last day for an approved order to take them (041), if their
  // 2 weeks have started.
  const soonest = waiting.filter((row) => row.deadline).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))[0]
  const notStarted = waiting.some((row) => !row.deadline)

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            <FontAwesomeIcon icon={faTruckFast} className="mr-2" />
            {forStaff ? "Goods waiting for customers' next orders" : 'Goods waiting for your next order'}:
            {' '}{plural(total.cases, 'case')} of {plural(total.products, 'product')}
            {forStaff && customers > 0 ? `, ${plural(customers, 'customer')}` : ''}
          </p>
          <p className="mt-0.5">
            {forStaff
              ? `From rush shipments. ${waiting.length ? `${plural(countOf(waiting).cases, 'case')} wait for the customer's next quotation` : ''}${waiting.length && joined.length ? '; ' : ''}${joined.length ? `${plural(countOf(joined).cases, 'case')} go with orders already placed` : ''}. They're already paid for, and go in the container of the customer's next order.`
              : `From your rush shipment${total.orders.length > 1 ? 's' : ''} (${total.orders.join(', ')}). They're already paid for, and go in the container of your next order${joined.length ? ` (${[...new Set(joined.map((row) => row.carried_into))].join(', ')} already has ${plural(countOf(joined).cases, 'case')} of them)` : ''}.`}
          </p>
          {waiting.length > 0 && (
            <p className="mt-1">
              {forStaff
                ? soonest
                  ? `The customer's next order must be approved within their 2 weeks, or they become DMC's (the soonest last day: ${deadlineText(soonest)}). Price their requests promptly.`
                  : 'Their 2 weeks start once they are all in and the rushed order\'s container has left.'
                : soonest
                  ? `Your next order must be approved by ${deadlineText(soonest)}: send a quotation request soon, with other products or with only these, so DMC can price it in time. That order's container and shipping are yours to pay. After that date, as you agreed, DMC may do what it wants with them.`
                  : 'Send a quotation request for them, with other products or with only these; that order\'s container and shipping are yours to pay. Once they are all in DMC\'s warehouse and your rushed order\'s container has left, you have 2 weeks to approve that order\'s quotation.'}
              {!forStaff && soonest && notStarted ? ' Goods not in yet get their 2 weeks once they are all in.' : ''}
            </p>
          )}
        </div>

        <button type="button" onClick={() => setOpen((value) => !value)} className="shrink-0 font-medium underline">
          {open ? 'Hide them' : 'See them'}
        </button>
      </div>

      {open && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-amber-200 bg-white text-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-amber-50/60 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {forStaff && <th className="px-3 py-2">Customer</th>}
                <th className="px-3 py-2">From order</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Cases</th>
                <th className="px-3 py-2">Goes with</th>
                <th className="px-3 py-2">Order by</th>
              </tr>
            </thead>
            <tbody>
              {toShip.map((row) => (
                <tr key={row.item_id} className="border-t border-amber-100">
                  {forStaff && <td className="px-3 py-2">{customerName ? customerName(row.customer_id) : '-'}</td>}
                  <td className="px-3 py-2">{row.order_number}</td>
                  <td className="px-3 py-2">{row.product_name}{row.pack_size ? ` (${row.pack_size})` : ''}</td>
                  <td className="px-3 py-2">{Number(row.cases).toLocaleString()} {row.unit || 'cases'}</td>
                  <td className="px-3 py-2">
                    {waitingState(row) === 'joined' ? row.carried_into : forStaff ? "The customer's next order" : 'Your next order'}
                  </td>
                  <td className="px-3 py-2">
                    {waitingState(row) === 'joined' ? '-' : deadlineText(row) || 'Once all in'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
