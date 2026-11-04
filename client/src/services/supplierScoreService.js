import { supabase } from '../supabase'
import { buildDeliveries, scoreSupplier, scoreSuppliers } from '../utils/supplierScores'


// =============================================================================
// Supplier scores — loading the data
//
// The maths lives in utils/supplierScores.js. Used by Supplier Performance and
// the Executive Dashboard, so both show the same score. Staff only: customers
// can't read purchase orders (db/migrations/013).
// =============================================================================

// Every finished delivery, for one supplier or for all of them, newest first.
// All lines are loaded, not just received ones, because a delivery only counts
// once every line from that supplier on the PO is in.
export async function loadDeliveries(supplierId) {
  let query = supabase
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


// One supplier's score, with its recent deliveries.
export async function loadSupplierScore(supplierId) {
  return scoreSupplier(await loadDeliveries(supplierId))
}


// Every supplier's score, by supplier id.
export async function loadSupplierScores(supplierIds) {
  return scoreSuppliers(await loadDeliveries(), supplierIds)
}
