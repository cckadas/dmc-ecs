// =============================================
// SHIP DATE SUMMARY
//
// An order's estimated ship date in one short line, for lists: "Around Nov 28",
// and whether that's on track for the date the customer asked for. Takes a
// customer's estimate from the server or a staff prediction; forStaff says
// "At risk" instead of "May be late".
// =============================================

const formatShort = (date) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export default function ShipDateSummary({ estimate, forStaff = false }) {
  if (!estimate || (!estimate.shipped && !estimate.estimatedShipDate)) {
    return <span className="text-sm text-gray-400">—</span>
  }

  if (estimate.shipped) {
    return (
      <span className="text-sm text-gray-700">
        Shipped{estimate.shippedOn ? ` ${formatShort(estimate.shippedOn)}` : ''}
      </span>
    )
  }

  const late = estimate.late ?? estimate.risk === 'at risk'

  return (
    <div>
      <p className="text-sm font-medium text-gray-800">
        {estimate.ifPaidToday ? 'If paid today: ' : 'Around '}
        {formatShort(estimate.estimatedShipDate)}
      </p>

      {late ? (
        <p className="text-xs font-medium text-amber-700">{forStaff ? 'At risk' : 'May be late'}</p>
      ) : estimate.requestedShipDate ? (
        <p className="text-xs font-medium text-green-700">On track</p>
      ) : null}
    </div>
  )
}
