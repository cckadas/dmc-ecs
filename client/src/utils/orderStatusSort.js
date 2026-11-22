// =============================================================================
// Sorting and showing the Customer Orders list by status
//
// Status order follows the order's steps, from waiting for the down payment to
// shipped, with cancelled orders last. "Payments to check" gathers every order
// with a payment waiting for sales: a first payment ("submitted") or a balance
// payment on an order further along. Pure: no imports.
// =============================================================================

export const STATUS_ORDER = [
  'pending payment',
  'submitted',
  'payment rejected',
  'payment verified',
  'procurement',
  'warehouse preparation',
  'ready for shipment',
  'partly shipped',
  'shipped',
  'cancelled',
]

export const TO_CHECK = 'payments to check'
export const ALL = 'all'

const normalize = (status) => String(status || '').trim().toLowerCase()

// As the status badges write it, e.g. "Payment Rejected".
export const statusLabel = (status) =>
  normalize(status).split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Unknown'

// A payment waits for sales to check it.
export const needsPaymentCheck = (order) =>
  normalize(order?.status) === 'submitted' || Number(order?.pending_payment_amount || 0) > 0

// An order's place in the status order; a status the list doesn't know goes last.
const rank = (order) => {
  const index = STATUS_ORDER.indexOf(normalize(order?.status))
  return index === -1 ? STATUS_ORDER.length : index
}

const newestFirst = (a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)

// how: 'status' (newest first within each status), 'newest' or 'oldest'.
export function sortOrders(orders, how = 'status') {
  const list = [...(orders || [])]
  if (how === 'oldest') return list.sort((a, b) => -newestFirst(a, b))
  if (how === 'newest') return list.sort(newestFirst)
  return list.sort((a, b) => rank(a) - rank(b) || newestFirst(a, b))
}

// show: ALL, TO_CHECK, or one status.
export function filterOrders(orders, show = ALL) {
  if (show === ALL) return [...(orders || [])]
  if (show === TO_CHECK) return (orders || []).filter(needsPaymentCheck)
  return (orders || []).filter((order) => normalize(order.status) === show)
}

// The choices for "Show", with how many orders each has: all, payments to
// check, then each status there is, in status order.
export function showChoices(orders) {
  const list = orders || []
  const count = {}
  for (const order of list) {
    const status = normalize(order.status)
    count[status] = (count[status] || 0) + 1
  }

  const statuses = Object.keys(count).sort((a, b) => {
    const ra = STATUS_ORDER.indexOf(a) === -1 ? STATUS_ORDER.length : STATUS_ORDER.indexOf(a)
    const rb = STATUS_ORDER.indexOf(b) === -1 ? STATUS_ORDER.length : STATUS_ORDER.indexOf(b)
    return ra - rb || a.localeCompare(b)
  })

  return [
    { value: ALL, label: 'All orders', count: list.length },
    { value: TO_CHECK, label: 'Payments to check', count: list.filter(needsPaymentCheck).length },
    ...statuses.map((status) => ({ value: status, label: statusLabel(status), count: count[status] })),
  ]
}
