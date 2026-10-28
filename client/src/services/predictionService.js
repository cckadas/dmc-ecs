import { supabase } from '../supabase'
import { buildStageStatistics, predictOrder } from '../utils/predictions'

export { ORDER_STATUS_FLOW, normalizeStatus, buildStageStatistics, predictOrder } from '../utils/predictions'


// =============================================================================
// Shipment predictions — loading the data
//
// The maths lives in utils/predictions.js (shared with the server's customer
// assistant). Used by the Executive Dashboard and the order progress tracker,
// so both show the same estimate.
// =============================================================================

const byTime = (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()


// Every recorded status change, oldest first.
export async function loadStatusHistory() {
  const { data, error } = await supabase
    .from('customer_order_status_history')
    .select('customer_order_id, previous_status, new_status, changed_at')
    .order('changed_at', { ascending: true })

  if (error) throw error

  return data || []
}


// Predictions for several orders at once.
export async function predictOrders(orders) {
  const history = await loadStatusHistory()
  const { stageStatistics, historyByOrder } = buildStageStatistics(history)
  return orders.map((order) => predictOrder(order, stageStatistics, historyByOrder))
}


// Everything the progress tracker needs for one order: its own status
// changes (for the step dates) and its prediction.
export async function loadOrderProgress(order) {
  const history = await loadStatusHistory()
  const { stageStatistics, historyByOrder } = buildStageStatistics(history)

  return {
    history: [...(historyByOrder[order.id] || [])].sort(byTime),
    prediction: predictOrder(order, stageStatistics, historyByOrder),
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
