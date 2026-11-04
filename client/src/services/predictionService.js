import { supabase } from '../supabase'
import { buildStageStatistics, predictOrder } from '../utils/predictions'
import { estimateContext, supplierHistories } from '../utils/estimateInputs'
import { loadDeliveries } from './supplierScoreService'

export { ORDER_STATUS_FLOW, normalizeStatus, buildStageStatistics, predictOrder } from '../utils/predictions'


// =============================================================================
// Shipment predictions — loading the data
//
// The maths lives in utils/predictions.js and the shaping of the rows in
// utils/estimateInputs.js, both shared with DMC's server. Used by the Executive
// Dashboard and the order progress tracker, so both show the same estimate.
//
// Staff read the whole picture: DMC's starting values (db/migrations/017), the
// order's purchase orders and each supplier's past deliveries. A customer can
// read none of those, so in their browser the estimate uses the built-in
// placeholders and the records of each step as a whole.
// =============================================================================

const byTime = (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()

// Rows, or none when the table can't be read (no access, or 017 not run yet).
const rowsOf = (result) => (result.error ? [] : result.data || [])


// Every recorded status change, oldest first. Estimates learn from all orders'
// timings, which a customer can't read directly, so this comes from the database
// with other customers' order IDs hidden (db/migrations/013).
export async function loadStatusHistory() {
  const { data, error } = await supabase.rpc('status_history_for_estimates')

  if (error) throw error

  return data || []
}


// DMC's starting values, entered on Prediction settings.
async function loadStartingValues() {
  const [settings, suppliers, countries, busyMonths] = await Promise.all([
    supabase.from('prediction_settings').select('key, days, is_placeholder'),
    supabase.from('prediction_suppliers').select('supplier_id, usual_lead_days, late_frequency, usual_late_days'),
    supabase.from('prediction_countries').select('country, sailing_days, extra_labeling_days, is_placeholder'),
    supabase.from('prediction_busy_months').select('month, extra_days'),
  ])

  return {
    settings: rowsOf(settings),
    startingSuppliers: Object.fromEntries(rowsOf(suppliers).map((row) => [row.supplier_id, row])),
    countries: rowsOf(countries),
    busyMonths: rowsOf(busyMonths),
  }
}


// The orders' items, delivery countries and purchase orders, the supplier
// names, and every supplier's past deliveries.
async function loadOrderDetails(orders) {
  const orderIds = orders.map((order) => order.id)
  const locationIds = [...new Set(orders.map((order) => order.delivery_location_id).filter(Boolean))]

  if (!orderIds.length) return { items: [], locations: [], purchaseOrders: [], poLines: [], names: {}, histories: {} }

  const [items, locations, purchaseOrders, suppliers, deliveries] = await Promise.all([
    supabase.from('customer_order_items').select('customer_order_id, quantity, products ( supplier_id )').in('customer_order_id', orderIds),
    locationIds.length
      ? supabase.from('delivery_locations').select('id, country').in('id', locationIds)
      : Promise.resolve({ data: [] }),
    supabase.from('purchase_orders').select('id, customer_order_id, expected_delivery_date').in('customer_order_id', orderIds),
    supabase.from('suppliers').select('id, supplier_name'),
    loadDeliveries().catch(() => []),
  ])

  const poIds = rowsOf(purchaseOrders).map((order) => order.id)
  const poLines = poIds.length
    ? rowsOf(await supabase.from('purchase_order_items').select('purchase_order_id, supplier_id, fully_received_at').in('purchase_order_id', poIds))
    : []

  return {
    items: rowsOf(items),
    locations: rowsOf(locations),
    purchaseOrders: rowsOf(purchaseOrders),
    poLines,
    names: Object.fromEntries(rowsOf(suppliers).map((supplier) => [supplier.id, supplier.supplier_name])),
    histories: supplierHistories(deliveries),
  }
}


// Predictions for several orders at once, with every order's history. Orders
// need id, status and created_at; requested_ship_date and delivery_location_id
// make the estimate check the customer's date and country.
export async function loadEstimates(orders) {
  const [history, starting, details] = await Promise.all([
    loadStatusHistory(),
    loadStartingValues(),
    loadOrderDetails(orders),
  ])

  const { stageStatistics, historyByOrder } = buildStageStatistics(history)

  const predictions = orders.map((order) => predictOrder(order, stageStatistics, historyByOrder, estimateContext({
    order,
    items: details.items.filter((item) => item.customer_order_id === order.id),
    purchaseOrders: details.purchaseOrders.filter((purchaseOrder) => purchaseOrder.customer_order_id === order.id),
    poLines: details.poLines,
    histories: details.histories,
    startingSuppliers: starting.startingSuppliers,
    supplierNames: details.names,
    settings: starting.settings,
    countries: starting.countries,
    busyMonths: starting.busyMonths,
    country: details.locations.find((location) => location.id === order.delivery_location_id)?.country,
  })))

  return { predictions, historyByOrder }
}


export async function predictOrders(orders) {
  return (await loadEstimates(orders)).predictions
}


// Everything the progress tracker needs for one order: its own status
// changes (for the step dates) and its prediction.
export async function loadOrderProgress(order) {
  const { predictions, historyByOrder } = await loadEstimates([order])

  return {
    history: [...(historyByOrder[order.id] || [])].sort(byTime),
    prediction: predictions[0],
  }
}


// Records a status change for the tracker's dates and future predictions.
// A failure here never undoes the change itself.
export async function recordStatusChange(customerOrderId, previousStatus, newStatus) {
  try {
    const { error } = await supabase
      .from('customer_order_status_history')
      .insert({
        customer_order_id: customerOrderId,
        previous_status: previousStatus,
        new_status: newStatus,
        changed_at: new Date().toISOString(),
      })

    if (error) throw error
  } catch (error) {
    console.error('Failed to record status change:', error)
  }
}
