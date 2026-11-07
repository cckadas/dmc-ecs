import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// Customer estimates
//
// A customer can't read DMC's starting values, purchase orders or supplier
// deliveries, so their estimates are worked out here, with the same loader and
// maths as the staff pages (client/src/utils/estimateLoader.js), and only the
// dates and plain words go back (forCustomer). Used by routes/estimates.js and
// the chatbot. The prediction alerts (alerts.js) use the same.
// =============================================================================

let shared = null

// Loaded when first needed, so the server starts even without the client folder.
export async function loadShared() {
  shared ||= await import(new URL('../client/src/utils/estimateLoader.js', import.meta.url).href)
  return shared
}


// Every status change, oldest first, for the step times. Read straight from the
// table: status_history_for_estimates answers signed-in users only.
export async function allStatusHistory(client = supabaseAdmin) {
  const { allRows } = await loadShared()

  return allRows(() => client
    .from('customer_order_status_history')
    .select('customer_order_id, new_status, changed_at')
    .order('changed_at', { ascending: true })
    .order('id', { ascending: true }))
}


// Estimates for a list of orders (each with id, status, created_at,
// requested_ship_date, delivery_location_id), the full version: the chatbot
// picks what to say from it.
export async function estimateCustomerOrders(orders, history) {
  const { estimateOrders } = await loadShared()
  return (await estimateOrders(supabaseAdmin, orders, history || await allStatusHistory())).predictions
}


// The customer-safe version of each order's estimate, e.g. for the chatbot,
// which sends what it gets to the AI provider.
export async function customerViewOf(orders, history) {
  const { forCustomer } = await loadShared()
  return (await estimateCustomerOrders(orders, history)).map(forCustomer)
}


// A customer's own orders, the customer-safe version.
export async function customerEstimates(customerId) {
  const { forCustomer } = await loadShared()

  const { data: orders, error } = await supabaseAdmin
    .from('customer_orders')
    .select('id, status, created_at, requested_ship_date, delivery_location_id')
    .eq('customer_id', customerId)

  if (error) throw error

  return (await estimateCustomerOrders(orders || [])).map(forCustomer)
}


// An order the customer hasn't placed yet, as if paid today: a quotation request
// being filled in, or a quotation they're viewing. Only their own delivery
// location counts. Their past orders tell whether its products are new to them.
export async function customerDraftEstimate(customerId, { items, deliveryLocationId, requestedShipDate, containerSize = null }) {
  const { estimateDraft, forCustomer } = await loadShared()

  let locationId = null
  if (deliveryLocationId) {
    const { data } = await supabaseAdmin
      .from('delivery_locations')
      .select('id')
      .eq('id', deliveryLocationId)
      .eq('profile_id', customerId)
      .maybeSingle()
    locationId = data?.id || null
  }

  const estimate = await estimateDraft(supabaseAdmin, {
    items,
    deliveryLocationId: locationId,
    requestedShipDate,
    customerId,
    containerSize,
    history: await allStatusHistory(),
  })

  return forCustomer(estimate)
}
