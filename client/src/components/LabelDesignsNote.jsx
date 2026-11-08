import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLanguage } from '@fortawesome/free-solid-svg-icons'

import { labelDesignsNeeded } from '../utils/labelDesigns'
import { count } from '../utils/chartFormat'


// Tells the customer when their translated label designs are holding up an
// order (utils/labelDesigns.js). compact: one short line, for the orders list.
export default function LabelDesignsNote({ order, compact = false }) {
  const waiting = labelDesignsNeeded(order)
  if (!waiting.length) return null

  if (compact) {
    return (
      <p className="text-xs font-medium text-amber-700">
        {count(waiting.length, 'label design')} needed
      </p>
    )
  }

  const names = waiting.map((item) => item.products?.product_name).filter(Boolean)

  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <FontAwesomeIcon icon={faLanguage} className="mt-0.5 h-4 w-4 shrink-0" />

      <div>
        <p className="font-medium">
          {waiting.length === 1
            ? 'Your label design for 1 product is still needed.'
            : `Your label designs for ${count(waiting.length, 'product')} are still needed.`}{' '}
          Labeling can't finish without {waiting.length === 1 ? 'it' : 'them'}.
        </p>

        {names.length > 0 && <p className="mt-1">{names.join(', ')}</p>}

        <Link to="/customer/compliance-label-customer" className="mt-2 inline-block font-medium text-amber-900 underline hover:text-amber-950">
          Upload them on Compliance Labels
        </Link>
      </div>
    </div>
  )
}
