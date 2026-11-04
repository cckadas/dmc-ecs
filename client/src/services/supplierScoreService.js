import { supabase } from '../supabase'
import { scoreSupplier, scoreSuppliers } from '../utils/supplierScores'
import { loadAllDeliveries } from '../utils/estimateLoader'


// =============================================================================
// Supplier scores — loading the data
//
// The maths lives in utils/supplierScores.js. Used by Supplier Performance, the
// Executive Dashboard and Prediction Settings, so all show the same score.
// Staff only: customers can't read purchase orders (db/migrations/013).
// =============================================================================

// Every finished delivery, for one supplier or for all of them, newest first.
export async function loadDeliveries(supplierId) {
  return loadAllDeliveries(supabase, supplierId)
}


// One supplier's score, with its recent deliveries.
export async function loadSupplierScore(supplierId) {
  return scoreSupplier(await loadDeliveries(supplierId))
}


// Every supplier's score, by supplier id.
export async function loadSupplierScores(supplierIds) {
  return scoreSuppliers(await loadDeliveries(), supplierIds)
}
