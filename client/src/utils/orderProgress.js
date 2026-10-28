// =============================================================================
// Order progress
//
// The six steps of an order's journey, shown to the customer (My Orders),
// sales and admin (Customer Orders) and management (Executive Dashboard).
// Payment has its own line under the steps, because the balance can be paid
// at any stage, even after shipping.
// =============================================================================

export const ORDER_STEPS = [
  { label: 'Order confirmed', status: 'pending payment' },
  { label: 'Down payment verified', status: 'payment verified' },
  { label: 'Procurement', status: 'procurement' },
  { label: 'Warehouse preparation', status: 'warehouse preparation' },
  { label: 'Ready for shipment', status: 'ready for shipment' },
  { label: 'Shipped', status: 'shipped' },
]

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

export const stepsDone = (status) => STEPS_DONE[(status || '').trim().toLowerCase()] ?? 1


// When each step was reached: the latest change into that step's status.
// The first step falls back to the order's creation date.
export function stepDates(order, history) {
  return ORDER_STEPS.map((step, index) => {
    const entry = [...history].reverse().find(
      (item) => (item.new_status || '').trim().toLowerCase() === step.status
    )

    if (entry) return new Date(entry.changed_at)
    if (index === 0 && order.created_at) return new Date(order.created_at)
    return null
  })
}
