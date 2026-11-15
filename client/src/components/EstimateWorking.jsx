import { useState } from 'react'

import { describeWorking } from '../utils/estimateWorking'
import TableScroll from './TableScroll'


// =============================================================================
// How an order's date is worked out — for staff
//
// Each step still to come, the days it adds, the day it should be done, and
// the records those days come from, adding up to the ship date
// (utils/estimateWorking.js puts utils/predictions.js's working in words).
// Anyone can check it by hand against the charts under "What the predictions
// learn from". It names suppliers, so customers never see it: their estimate
// comes without it.
// =============================================================================

const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
const shortDay = (value) => dayFormat.format(new Date(value))

const HEAD = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500'
const CELL = 'px-3 py-2 align-top text-sm text-gray-700'

// The days a step adds, to one decimal so the steps can be added up by hand;
// under a day, in hours.
function adds(days) {
  if (days < 1 / 24) return 'under an hour'
  if (days < 1) {
    const hours = Math.round(days * 24)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  const rounded = Math.round(days * 10) / 10
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}


// The working itself, as a table.
export function EstimateWorkingTable({ working }) {
  const words = describeWorking(working)
  if (!words) return null

  return (
    <div>
      <p className="text-sm text-gray-600">
        From today ({shortDay(words.from)}){words.ifPaidToday ? ', if the down payment is made today' : ''}, each step
        still to come adds the days it usually takes, learned from the system's own records:
      </p>

      <TableScroll className="mt-2 rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className={HEAD}>Step</th>
              <th className={`${HEAD} whitespace-nowrap`}>Adds</th>
              <th className={`${HEAD} whitespace-nowrap`}>Done around</th>
              <th className={HEAD}>Worked out from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {words.rows.map((row) => (
              <tr key={row.key}>
                <td className={CELL}>
                  <p className="font-medium text-gray-800">{row.label}</p>
                  {row.current && <p className="text-xs text-gray-500">where it is now</p>}
                </td>
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>{adds(row.days)}</td>
                <td className={`${CELL} whitespace-nowrap`}>{shortDay(row.endsOn)}</td>
                <td className={CELL}>
                  {row.lines.map((line) => <p key={line} className="mb-1 last:mb-0">{line}</p>)}
                </td>
              </tr>
            ))}

            <tr className="bg-[#F4F8F5]">
              <td className={`${CELL} font-semibold text-gray-800`}>Ships around</td>
              <td className={`${CELL} whitespace-nowrap font-semibold tabular-nums text-gray-800`}>{adds(words.total)} in all</td>
              <td className={`${CELL} whitespace-nowrap font-semibold text-gray-800`}>{shortDay(words.shipsOn)}</td>
              <td className={CELL}>{words.range}</td>
            </tr>

            {words.sailing && (
              <tr>
                <td className={CELL}>
                  <p className="font-medium text-gray-800">At sea</p>
                  <p className="text-xs text-gray-500">then it arrives</p>
                </td>
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>{adds(words.sailing.days)}</td>
                <td className={`${CELL} whitespace-nowrap`}>{shortDay(words.sailing.arrivesOn)}</td>
                <td className={CELL}>{words.sailing.line}</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
    </div>
  )
}


// The working behind a link, closed until asked for.
export default function EstimateWorking({ working }) {
  const [open, setOpen] = useState(false)
  if (!working?.steps?.length) return null

  return (
    <div className="pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="text-sm font-medium text-[#2D5A42] hover:underline"
      >
        {open ? 'Hide how this date is worked out' : 'How this date is worked out'}
      </button>

      {open && (
        <div className="mt-2">
          <EstimateWorkingTable working={working} />
        </div>
      )}
    </div>
  )
}
