// =============================================================================
// Order progress
//
// The seven steps of an order's journey, shown to the customer (My Orders),
// sales and admin (Customer Orders) and management (Executive Dashboard).
// The last, Arrived, isn't an order status: it's the day staff record a
// shipped order's container arrived (db/migrations/025). Payment has its own
// line under the steps, because the balance can be paid at any stage, even
// after shipping.
// =============================================================================

export const ORDER_STEPS = [
  { label: 'Order confirmed', status: 'pending payment' },
  { label: 'Down payment verified', status: 'payment verified' },
  { label: 'Procurement', status: 'procurement' },
  { label: 'Warehouse preparation', status: 'warehouse preparation' },
  { label: 'Ready for shipment', status: 'ready for shipment' },
  { label: 'Shipped', status: 'shipped' },
  { label: 'Arrived', status: 'arrived' },
]

export const ARRIVED_STEP = ORDER_STEPS.length - 1

// How many steps an order in this status has completed.
const STEPS_DONE = {
  'pending payment': 1,
  submitted: 1,
  'payment rejected': 1,
  'payment verified': 2,
  procurement: 3,
  'warehouse preparation': 4,
  'ready for shipment': 5,
  shipped: 6,
}

// A shipped order whose arrival is recorded has done all seven.
export const stepsDone = (status, arrived = false) => {
  const done = STEPS_DONE[(status || '').trim().toLowerCase()] ?? 1
  return done === ARRIVED_STEP && arrived ? ORDER_STEPS.length : done
}


// When each step was reached: the latest change into that step's status.
// The first step falls back to the order's creation date; Arrived is the
// recorded arrival day (YYYY-MM-DD), at midday in the Philippines.
export function stepDates(order, history, arrivedOn = null) {
  return ORDER_STEPS.map((step, index) => {
    if (index === ARRIVED_STEP) return arrivedOn ? new Date(`${String(arrivedOn).slice(0, 10)}T12:00:00+08:00`) : null

    const entry = [...history].reverse().find(
      (item) => (item.new_status || '').trim().toLowerCase() === step.status
    )

    if (entry) return new Date(entry.changed_at)
    if (index === 0 && order.created_at) return new Date(order.created_at)
    return null
  })
}
