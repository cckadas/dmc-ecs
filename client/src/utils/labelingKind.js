// =============================================================================
// Labeling kinds — DMC's three labeling times
//
// DMC's warehouse (Nov 2026): labeling an order takes about a week when the
// customer has ordered all its products before, two weeks when it fills a
// 40-ft container, and three weeks when the customer or one of its products is
// new, since those labels have to be made first. So each order is one of:
//   regular  every product ordered before by this customer, in a 20-ft
//   big      every product ordered before, in a 40-ft or a 40-ft high cube
//   new      the customer's first order, or a product they hadn't ordered before
// Each kind has its own starting days on Prediction Settings, and the records
// of each kind are kept apart (utils/predictions.js).
//
// Imports carry their .js extension so the server (Node) can load this too.
// =============================================================================

export const LABELING_KINDS = ['regular', 'big', 'new']

// Each kind's starting days, by prediction_settings key.
export const LABELING_SETTING = { regular: 'labeling', big: 'labeling_big_container', new: 'labeling_new' }

// container_sizes codes: '20-ft', '40-ft', '40-ft HC'.
export const isBigContainer = (code) => /^\s*40/.test(String(code || ''))

const isCancelled = (order) => String(order?.status || '').trim().toLowerCase() === 'cancelled'


// One order's kind, from the products its customer ordered before it.
// Null when it has no products to judge by.
export function labelingKindOf({ productIds = [], earlierProductIds = new Set(), containerSize = null }) {
  if (!productIds.length) return null
  if (productIds.some((id) => !earlierProductIds.has(id))) return 'new'
  return isBigContainer(containerSize) ? 'big' : 'regular'
}


// Each order's products, by order id. items: { customer_order_id, product_id }.
function productsByOrder(items) {
  const products = new Map()
  for (const item of items) {
    if (!item.product_id) continue
    if (!products.has(item.customer_order_id)) products.set(item.customer_order_id, [])
    products.get(item.customer_order_id).push(item.product_id)
  }
  return products
}


// Every order's kind, as a Map of order id to kind. An order is new when it has
// a product its customer hadn't ordered in an earlier order; cancelled orders
// don't count as ordered before.
//   orders: { id, customer_id, created_at, status, container_size }
//   items:  { customer_order_id, product_id }
export function labelingKinds(orders = [], items = []) {
  const products = productsByOrder(items)
  const byCustomer = new Map()

  for (const order of orders) {
    const customer = order.customer_id || `order:${order.id}`
    if (!byCustomer.has(customer)) byCustomer.set(customer, [])
    byCustomer.get(customer).push(order)
  }

  const kinds = new Map()

  for (const theirs of byCustomer.values()) {
    theirs.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || String(a.id).localeCompare(String(b.id)))
    const ordered = new Set()

    for (const order of theirs) {
      const productIds = products.get(order.id) || []
      const kind = labelingKindOf({ productIds, earlierProductIds: ordered, containerSize: order.container_size })
      if (kind) kinds.set(order.id, kind)
      if (!isCancelled(order)) productIds.forEach((id) => ordered.add(id))
    }
  }

  return kinds
}


// The products a customer has ordered (cancelled orders aside), for an order
// they haven't placed yet.
export function productsOrderedBy(customerId, orders = [], items = []) {
  if (!customerId) return new Set()
  const theirOrders = new Set(orders.filter((order) => order.customer_id === customerId && !isCancelled(order)).map((order) => order.id))
  return new Set(items.filter((item) => theirOrders.has(item.customer_order_id) && item.product_id).map((item) => item.product_id))
}
