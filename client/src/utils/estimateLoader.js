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

import { buildStageStatistics, predictOrder, supplierArrivals } from './predictions.js'
import { estimateContext, startingDaysFrom, supplierHistories } from './estimateInputs.js'
import { buildDeliveries, manilaDate } from './supplierScores.js'
import { MODEL_KEYS, modelPredictor } from './predictionModel.js'

// Rows, or none when the table can't be read (no access, or 017 not run yet).
const rowsOf = (result) => (result?.error ? [] : result?.data || [])


// Every row of a query. The API returns at most 1,000 rows per request, so the
// rows come a page at a time until a page comes back empty. makeQuery builds a
// fresh query each time, in a fixed order, so no row is missed or repeated.
export async function allRows(makeQuery, pageSize = 1000) {
  const rows = []

  for (let from = 0; ; ) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
    from += data.length
  }
}


// Every finished delivery (utils/supplierScores.js), for one supplier or all.
// All lines are loaded, since a delivery counts only once every line from that
// supplier on the PO is in.
export async function loadAllDeliveries(client, supplierId) {
  const lines = await allRows(() => {
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
      .order('id')

    if (supplierId) query = query.eq('supplier_id', supplierId)
    return query
  })

  return buildDeliveries(lines)
}


// DMC's starting values, entered on Prediction settings (db/migrations/017).
export async function loadStartingValues(client) {
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


// Every supplier delivery not in yet (one supplier's part of one PO), with when
// it should arrive: its promised date moved by how late that supplier usually
// is, as in the estimates (with the model where it's in use). Also the cases
// still to come and their volume, and whether it's likely to come late.
// Soonest first. For Receiving, the Purchase Orders list and the overdue alerts.
export async function loadOpenDeliveries(client, { now = Date.now() } = {}) {
  const [starting, lines, suppliers, models] = await Promise.all([
    loadStartingValues(client),
    allRows(() => client
      .from('purchase_order_items')
      .select('purchase_order_id, supplier_id, ordered_quantity, received_quantity, fully_received_at, products ( cbm ), purchase_orders ( id, po_number, customer_order_id, created_at, expected_delivery_date )')
      .order('id')),
    client.from('suppliers').select('id, supplier_name'),
    loadModels(client),
  ])

  // The same lines give each supplier's finished deliveries, for its lateness.
  const histories = supplierHistories(buildDeliveries(lines))
  const startingDays = startingDaysFrom(starting.settings)
  const names = Object.fromEntries(rowsOf(suppliers).map((supplier) => [supplier.id, supplier.supplier_name]))
  const fromNow = { typical: now, quick: now, slow: now }

  // What each supplier was asked for on each PO, for the model.
  const asked = new Map()
  for (const line of lines) {
    const key = `${line.purchase_orders?.id}:${line.supplier_id}`
    const entry = asked.get(key) || { cases: 0, products: 0 }
    entry.cases += Number(line.ordered_quantity) || 0
    entry.products += 1
    asked.set(key, entry)
  }

  // One delivery per supplier per PO, counting only what's still to come.
  const open = new Map()
  for (const line of lines) {
    const order = line.purchase_orders
    const remaining = Number(line.ordered_quantity || 0) - Number(line.received_quantity || 0)
    if (!order?.expected_delivery_date || line.fully_received_at || remaining <= 0) continue

    const key = `${order.id}:${line.supplier_id}`
    if (!open.has(key)) open.set(key, { order, supplierId: line.supplier_id, cases: 0, volume: 0 })
    const delivery = open.get(key)
    delivery.cases += remaining
    delivery.volume += remaining * (Number(line.products?.cbm) || 0)
  }

  return [...open.values()].map(({ order, supplierId, cases, volume }) => {
    const theirs = starting.startingSuppliers[supplierId]
    const whole = asked.get(`${order.id}:${supplierId}`) || { cases, products: 1 }
    const supplier = {
      supplierId,
      name: names[supplierId] || 'A supplier',
      promised: order.expected_delivery_date,
      orderedOn: order.created_at ? manilaDate(order.created_at) : null,
      cases: whole.cases,
      products: whole.products,
      history: histories[supplierId] || { leadDays: [], lateness: [] },
      starting: theirs ? { usualLeadDays: theirs.usual_lead_days, lateFrequency: theirs.late_frequency, usualLateDays: theirs.usual_late_days } : null,
    }
    const { ends, overdue } = supplierArrivals([supplier], fromNow, now, startingDays, () => 0, models.supplier)
    const expectedDay = manilaDate(ends.typical)

    return {
      purchaseOrderId: order.id,
      customerOrderId: order.customer_order_id,
      poNumber: order.po_number,
      supplierId,
      supplierName: supplier.name,
      promised: order.expected_delivery_date,
      expectedOn: new Date(ends.typical),
      expectedDay,
      overdueDays: overdue[0]?.days ?? 0,
      // Not overdue yet, but expected after the promised date.
      likelyLate: !overdue.length && expectedDay > String(order.expected_delivery_date).slice(0, 10),
      cases,
      volume,
    }
  }).sort((a, b) => a.expectedOn - b.expectedOn)
}


// The saved models (db/migrations/019). inUseOnly: only those that beat the
// statistics, as the estimates use them; else all, for the accuracy check.
// None when 019 isn't run, or the reader can't see them (customers).
export async function loadModels(client, { inUseOnly = true } = {}) {
  const result = await client.from('prediction_models').select('key, weights, spec, metrics, in_use, trained_at')
  const rows = rowsOf(result)
  const pick = (key) => {
    const row = rows.find((entry) => entry.key === key)
    return row && (!inUseOnly || row.in_use) ? modelPredictor(row) : null
  }

  return {
    available: !result?.error,
    supplier: pick(MODEL_KEYS.supplier),
    labeling: pick(MODEL_KEYS.labeling),
    rows: rows.map(({ key, metrics, in_use: inUse, trained_at: trainedAt }) => ({ key, metrics, inUse, trainedAt })),
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
    client.from('purchase_orders').select('id, customer_order_id, created_at, expected_delivery_date').in('customer_order_id', orderIds),
  ])

  const poIds = rowsOf(purchaseOrders).map((order) => order.id)
  const poLines = poIds.length
    ? rowsOf(await client.from('purchase_order_items').select('purchase_order_id, supplier_id, ordered_quantity, fully_received_at').in('purchase_order_id', poIds))
    : []

  return { items: rowsOf(items), locations: rowsOf(locations), purchaseOrders: rowsOf(purchaseOrders), poLines }
}


// Each order's estimate, with every order's history. Orders need id, status
// and created_at; requested_ship_date and delivery_location_id let it check the
// customer's date and country. history = every status change: the browser reads
// it through status_history_for_estimates, the server straight from the table.
export async function estimateOrders(client, orders, history) {
  const [starting, records, details, models] = await Promise.all([
    loadStartingValues(client),
    loadSupplierRecords(client),
    loadOrderDetails(client, orders),
    loadModels(client),
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
    models,
  })))

  return { predictions, historyByOrder }
}


// An order not placed yet, as if its down payment were made today: for a
// quotation request being filled in, or a quotation the customer is looking at.
//   items: [{ product_id, quantity }]
export async function estimateDraft(client, { items = [], deliveryLocationId, requestedShipDate, history = [] }) {
  const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))]

  const [starting, records, products, location, models] = await Promise.all([
    loadStartingValues(client),
    loadSupplierRecords(client),
    productIds.length
      ? client.from('products').select('id, supplier_id').in('id', productIds)
      : Promise.resolve({ data: [] }),
    deliveryLocationId
      ? client.from('delivery_locations').select('country').eq('id', deliveryLocationId).maybeSingle()
      : Promise.resolve({ data: null }),
    loadModels(client),
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
    models,
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
