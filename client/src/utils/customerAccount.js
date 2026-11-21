// =============================================================================
// Where a customer's account stands (db/migrations/038)
//
//   active          as usual
//   no new orders   admin stopped their new orders: they can still sign in,
//                   pay and follow their orders, but can't send requests,
//                   approve quotations, ask for a new quote or rush
//   deactivated     can't sign in; every record stays
//   deleted         the person is erased; their records stay, as "Deleted customer"
// Pure: the predictions use it too.
// =============================================================================

// The profile columns 038 adds (asked again without them until it's run).
export const ACCOUNT_COLUMNS = ['new_orders_stopped_at', 'deactivated_at', 'erased_at']

export function accountStatusOf(customer) {
  if (customer?.erased_at) return 'deleted'
  if (customer?.is_active === false) return 'deactivated'
  if (customer?.new_orders_stopped_at) return 'no new orders'
  return 'active'
}

// The customer can't start anything new: no requests, approvals or rushes.
export const newOrdersStopped = (customer) => accountStatusOf(customer) !== 'active'

export const ACCOUNT_STATUS_TEXT = {
  active: 'Active',
  'no new orders': 'No new orders',
  deactivated: 'Deactivated',
  deleted: 'Deleted',
}
