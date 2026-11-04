// =============================================================================
// Estimate loader — fetching what an estimate needs, with any Supabase client
//
// The browser's client for staff (services/predictionService.js) and the
// server's for customers and the chatbot (server/estimates.js) load the same
// rows here, so an order's estimate is the same wherever it's shown. The maths
// is in utils/predictions.js, the shaping of the rows in utils/estimateInputs.js.
//
// Imports carry their .js extension so the server (Node) can load this too.
// =============================================================================

import { buildStageStatistics, predictOrder } from './predictions.js'
import { estimateContext, supplierHistories } from './estimateInputs.js'
import { buildDeliveries } from './supplierScores.js'

// Rows, or none when the table can't be read (no access, or 017 not run yet).
const rowsOf = (result) => (result?.error ? [] : result?.data || [])


// Every finished delivery (utils/supplierScores.js), for one supplier or all.
// All lines are loaded, since a delivery counts only once every line from that
// supplier on the PO is in.
export async function loadAllDeliveries(client, supplierId) {
  let query = client
    .from('purchase_order_items')
    .select(`
      supplier_id,
      fully_received_at,
      purchase_orders (
        id,
        po_number,
        created_at,
        expected_delivery_date
      )
    `)

  if (supplierId) query = query.eq('supplier_id', supplierId)

  const { data, error } = await query

  if (error) throw error

  return buildDeliveries(data || [])
}


// DMC's starting values, entered on Prediction settings (db/migrations/017).
async function loadStartingValues(client) {
  const [settings, suppliers, countries, busyMonths] = await Promise.all([
    client.from('prediction_settings').select('key, days, is_placeholder'),
    client.from('prediction_suppliers').select('supplier_id, usual_lead_days, late_frequency, usual_late_days'),
    client.from('prediction_countries').select('country, sailing_days, extra_labeling_days, is_placeholder'),
    client.from('prediction_busy_months').select('month, extra_days'),
  ])

  return {
    settings: rowsOf(settings),
    startingSuppliers: Object.fromEntries(rowsOf(suppliers).map((row) => [row.supplier_id, row])),
    countries: rowsOf(countries),
    busyMonths: rowsOf(busyMonths),
  }
}


// The supplier names and every supplier's past deliveries.
async function loadSupplierRecords(client) {
  const [suppliers, deliveries] = await Promise.all([
    client.from('suppliers').select('id, supplier_name'),
    loadAllDeliveries(client).catch(() => []),
  ])

  return {
    names: Object.fromEntries(rowsOf(suppliers).map((supplier) => [supplier.id, supplier.supplier_name])),
    histories: supplierHistories(deliveries),
  }
}


// The orders' items, delivery countries and purchase orders.
async function loadOrderDetails(client, orders) {
  const orderIds = orders.map((order) => order.id)
  const locationIds = [...new Set(orders.map((order) => order.delivery_location_id).filter(Boolean))]

  if (!orderIds.length) return { items: [], locations: [], purchaseOrders: [], poLines: [] }

  const [items, locations, purchaseOrders] = await Promise.all([
    client.from('customer_order_items').select('customer_order_id, quantity, products ( supplier_id )').in('customer_order_id', orderIds),
    locationIds.length
      ? client.from('delivery_locations').select('id, country').in('id', locationIds)
      : Promise.resolve({ data: [] }),
    client.from('purchase_orders').select('id, customer_order_id, expected_delivery_date').in('customer_order_id', orderIds),
  ])

  const poIds = rowsOf(purchaseOrders).map((order) => order.id)
  const poLines = poIds.length
    ? rowsOf(await client.from('purchase_order_items').select('purchase_order_id, supplier_id, fully_received_at').in('purchase_order_id', poIds))
    : []

  return { items: rowsOf(items), locations: rowsOf(locations), purchaseOrders: rowsOf(purchaseOrders), poLines }
}


// Each order's estimate, with every order's history. Orders need id, status
// and created_at; requested_ship_date and delivery_location_id let it check the
// customer's date and country. history = every status change: the browser reads
// it through status_history_for_estimates, the server straight from the table.
export async function estimateOrders(client, orders, history) {
  const [starting, records, details] = await Promise.all([
    loadStartingValues(client),
    loadSupplierRecords(client),
    loadOrderDetails(client, orders),
  ])

  const { stageStatistics, historyByOrder } = buildStageStatistics(history)

  const predictions = orders.map((order) => predictOrder(order, stageStatistics, historyByOrder, estimateContext({
    order,
    items: details.items.filter((item) => item.customer_order_id === order.id),
    purchaseOrders: details.purchaseOrders.filter((purchaseOrder) => purchaseOrder.customer_order_id === order.id),
    poLines: details.poLines,
    histories: records.histories,
    startingSuppliers: starting.startingSuppliers,
    supplierNames: records.names,
    settings: starting.settings,
    countries: starting.countries,
    busyMonths: starting.busyMonths,
    country: details.locations.find((location) => location.id === order.delivery_location_id)?.country,
  })))

  return { predictions, historyByOrder }
}


// An order not placed yet, as if its down payment were made today: for a
// quotation request being filled in, or a quotation the customer is looking at.
//   items: [{ product_id, quantity }]
export async function estimateDraft(client, { items = [], deliveryLocationId, requestedShipDate, history = [] }) {
  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))]

  const [starting, records, products, location] = await Promise.all([
    loadStartingValues(client),
    loadSupplierRecords(client),
    productIds.length
      ? client.from('products').select('id, supplier_id').in('id', productIds)
      : Promise.resolve({ data: [] }),
    deliveryLocationId
      ? client.from('delivery_locations').select('country').eq('id', deliveryLocationId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const supplierOf = Object.fromEntries(rowsOf(products).map((product) => [product.id, product.supplier_id]))
  const draftItems = items.map((item) => ({ quantity: item.quantity, products: { supplier_id: supplierOf[item.product_id] } }))
  const order = { id: 'draft', status: 'pending payment', created_at: new Date().toISOString(), requested_ship_date: requestedShipDate || null }

  const { stageStatistics, historyByOrder } = buildStageStatistics(history)

  return predictOrder(order, stageStatistics, historyByOrder, estimateContext({
    order,
    items: draftItems,
    purchaseOrders: [],
    poLines: [],
    histories: records.histories,
    startingSuppliers: starting.startingSuppliers,
    supplierNames: records.names,
    settings: starting.settings,
    countries: starting.countries,
    busyMonths: starting.busyMonths,
    country: location?.data?.country,
  }))
}


// What a customer may see of an estimate: the dates and plain words. Never the
// reasons, which can name suppliers, or the confidence (customers get the range).
export function forCustomer(prediction) {
  if (!prediction) return null

  if (prediction.shipped) {
    return { orderId: prediction.id, shipped: true, shippedOn: prediction.shippedOn || null }
  }

  return {
    orderId: prediction.id,
    shipped: false,
    ifPaidToday: Boolean(prediction.ifPaidToday),
    estimatedReadyDate: prediction.estimatedReadyDate || null,
    estimatedShipDate: prediction.estimatedShipDate || null,
    shipDateRange: prediction.shipDateRange || null,
    estimatedArrivalDate: prediction.estimatedArrivalDate || null,
    requestedShipDate: prediction.requestedShipDate || null,
    daysPastRequested: prediction.daysPastRequested ?? null,
    customerNote: prediction.customerNote || null,
    roughEstimate: Boolean(prediction.roughEstimate),
    late: prediction.risk === 'at risk',
    stepsAhead: (prediction.stepsAhead || []).map(({ key, label, expectedEnd }) => ({ key, label, expectedEnd })),
  }
}
