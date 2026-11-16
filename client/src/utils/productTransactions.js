// =============================================================================
// A product's transactions — every record it's in
//
// For looking a product up: the quotation requests and quotations that include
// it, the customer orders, and the purchase orders with each time their goods
// were received. One row for each line it's on, newest first, with totals.
//
// It only lists what's on record: no forecast, nothing learned. A product is
// one pack size; its other sizes (the same family) can be looked up with it,
// and each row then says which size it is.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { productDeliveries } from './productDeliveries.js'

const normalize = (status) => String(status || '').trim().toLowerCase()
const cases = (value) => Number(value) || 0
const newestFirst = (a, b) => Date.parse(b.at) - Date.parse(a.at) || String(b.number).localeCompare(String(a.number))
const customerName = (customer) => customer?.company || customer?.name || null


//   products:       [{ id, product_name, pack_size }]   the sizes looked up
//   requestItems:   [{ id, product_id, quantity,
//                      quotation_requests: { id, quotation_reference, status, created_at, profiles } }]
//   quotationItems: [{ id, product_id, quantity,
//                      quotations: { id, quotation_number, status, created_at, expiry_date,
//                                    quotation_requests: { profiles } } }]
//   orderItems:     [{ id, product_id, quantity,
//                      customer_orders: { id, order_number, status, created_at, customer_id } }]
//   poLines:        [{ id, product_id, supplier_id, ordered_quantity, received_quantity, status,
//                      fully_received_at,
//                      purchase_orders: { id, po_number, created_at, expected_delivery_date,
//                                         customer_orders: { order_number } } }]
//   receivings:     the POs' "goods received" history entries (utils/productDeliveries.js)
//   suppliers:      { supplier id: name }
//   customers:      { customer id: { name, company } }   for the orders
// Returns, each list newest first, each row with `size` (which pack size) and
// `cases`:
//   requests        { id, number, at, customer, status }
//   quotations      { id, number, at, customer, status, expires }
//   orders          { id, number, at, customer, status, cancelled }
//   purchaseOrders  { id, number, at, supplier, forOrder, received, toCome,
//                     promised, status, receivings: [oldest first] }
//   totals          { requested, quoted, ordered, purchased, received, toCome };
//                   cancelled orders aren't in `ordered`
export function productTransactions({ products = [], requestItems = [], quotationItems = [], orderItems = [], poLines = [], receivings = [], suppliers = {}, customers = {}, today = new Date() }) {
  const sizeOf = Object.fromEntries(products.map((product) => [product.id, product.pack_size || product.product_name || null]))

  const requests = requestItems
    .filter((item) => item.quotation_requests)
    .map((item) => ({
      id: item.id,
      number: item.quotation_requests.quotation_reference || null,
      at: item.quotation_requests.created_at,
      customer: customerName(item.quotation_requests.profiles),
      cases: cases(item.quantity),
      status: item.quotation_requests.status || null,
      size: sizeOf[item.product_id] || null,
    }))
    .sort(newestFirst)

  const quotations = quotationItems
    .filter((item) => item.quotations)
    .map((item) => ({
      id: item.id,
      number: item.quotations.quotation_number || null,
      at: item.quotations.created_at,
      customer: customerName(item.quotations.quotation_requests?.profiles),
      cases: cases(item.quantity),
      status: item.quotations.status || null,
      expires: item.quotations.expiry_date || null,
      size: sizeOf[item.product_id] || null,
    }))
    .sort(newestFirst)

  const orders = orderItems
    .filter((item) => item.customer_orders)
    .map((item) => ({
      id: item.id,
      number: item.customer_orders.order_number || null,
      at: item.customer_orders.created_at,
      customer: customerName(customers[item.customer_orders.customer_id]),
      cases: cases(item.quantity),
      status: item.customer_orders.status || null,
      cancelled: normalize(item.customer_orders.status) === 'cancelled',
      size: sizeOf[item.product_id] || null,
    }))
    .sort(newestFirst)

  // Each time a line's goods came in, oldest first, by line.
  const received = new Map()
  for (const entry of [...productDeliveries({ lines: poLines, events: receivings, suppliers, today }).received].reverse()) {
    if (!received.has(entry.lineId)) received.set(entry.lineId, [])
    received.get(entry.lineId).push({ id: entry.id, at: entry.at, cases: entry.cases, soFar: entry.soFar, kind: entry.kind, test: entry.test })
  }

  const purchaseOrders = poLines
    .filter((line) => line.purchase_orders)
    .map((line) => ({
      id: line.id,
      number: line.purchase_orders.po_number || null,
      at: line.purchase_orders.created_at,
      supplier: suppliers[line.supplier_id] || null,
      forOrder: line.purchase_orders.customer_orders?.order_number || null,
      cases: cases(line.ordered_quantity),
      received: cases(line.received_quantity),
      toCome: Math.max(cases(line.ordered_quantity) - cases(line.received_quantity), 0),
      promised: line.purchase_orders.expected_delivery_date ? String(line.purchase_orders.expected_delivery_date).slice(0, 10) : null,
      status: line.status || null,
      receivings: received.get(line.id) || [],
      size: sizeOf[line.product_id] || null,
    }))
    .sort(newestFirst)

  const sum = (rows, field = 'cases') => rows.reduce((total, row) => total + row[field], 0)

  return {
    requests,
    quotations,
    orders,
    purchaseOrders,
    totals: {
      requested: sum(requests),
      quoted: sum(quotations),
      ordered: sum(orders.filter((order) => !order.cancelled)),
      purchased: sum(purchaseOrders),
      received: sum(purchaseOrders, 'received'),
      toCome: sum(purchaseOrders, 'toCome'),
    },
  }
}
