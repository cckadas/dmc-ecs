import { supabase } from '../supabase'
import { loadStatusHistory } from './predictionService'
import { allRows, loadStartingValues } from '../utils/estimateLoader'
import { trainModels } from '../utils/modelTrainer'
import { MODEL_MAX_AGE_DAYS } from '../utils/predictionModel'
import { isSimulated } from '../utils/simulated'


// =============================================================================
// Training the prediction model, in the browser
//
// From the Predictive Analytics page: management or admin clicks Retrain, or
// the page retrains by itself once the saved model is over 7 days old. The
// maths is in utils/modelTrainer.js. The weights are saved in
// prediction_models (db/migrations/019), where every estimate reads them.
// =============================================================================

const DAY = 24 * 60 * 60 * 1000


// TensorFlow.js (its core, layers and the CPU backend), loaded only now.
async function loadTensorflow() {
  const [tf, , tfl] = await Promise.all([
    import('@tensorflow/tfjs-core'),
    import('@tensorflow/tfjs-backend-cpu'),
    import('@tensorflow/tfjs-layers'),
  ])
  await tf.setBackend('cpu')
  await tf.ready()
  return { tf, tfl }
}


// Never trained, trained over 7 days ago, or saved before its inputs changed.
export function modelIsStale(rows = []) {
  return !rows.length || rows.some((row) => row.outdated || !row.trainedAt || Date.now() - Date.parse(row.trainedAt) > MODEL_MAX_AGE_DAYS * DAY)
}


// Trains both models and saves those it could train. One it can't train any
// more (too few records) is deleted, so it isn't used without them. Returns,
// for each, how it did, or why it couldn't be trained yet.
export async function retrainModels(trainedBy, onProgress) {
  const [libs, history, starting, lines, orders, items, locations] = await Promise.all([
    loadTensorflow(),
    loadStatusHistory(),
    loadStartingValues(supabase),
    allRows(() => supabase
      .from('purchase_order_items')
      .select('supplier_id, ordered_quantity, fully_received_at, purchase_orders ( id, po_number, customer_order_id, created_at, expected_delivery_date )')
      .order('id')),
    allRows(() => supabase.from('customer_orders').select('id, order_number, status, delivery_location_id, customer_id, created_at, container_size').order('id')),
    allRows(() => supabase.from('customer_order_items').select('customer_order_id, quantity, product_id').order('id')),
    allRows(() => supabase.from('delivery_locations').select('id, country').order('id')),
  ])

  const results = await trainModels(libs, { lines, history, orders, items, locations, starting }, { onProgress })

  // Learned partly from the made-up demo history (db/demo/), so the page says so.
  const simulated = orders.some((order) => isSimulated(order.order_number))
    || lines.some((line) => isSimulated(line.purchase_orders?.po_number))

  const rows = results
    .filter((result) => result.trained)
    .map((result) => ({
      key: result.key,
      weights: result.weights,
      spec: result.spec,
      metrics: { ...result.metrics, simulated },
      in_use: result.inUse,
      trained_at: new Date().toISOString(),
      trained_by: trainedBy || null,
    }))

  if (rows.length) {
    const { error } = await supabase.from('prediction_models').upsert(rows, { onConflict: 'key' })
    if (error) throw error
  }

  const untrained = results.filter((result) => !result.trained).map((result) => result.key)
  if (untrained.length) {
    const { error } = await supabase.from('prediction_models').delete().in('key', untrained)
    if (error) throw error
  }

  return results
}
