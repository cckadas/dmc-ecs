import { supabase } from '../supabase'
import { withNewColumns } from '../utils/newColumns'


// =============================================================================
// Warehouse slots with what each holds (db/migrations/043)
//
// Every slot (warehouse_racks row), each with `contents`: the delivery lines in
// it, how many cases, each case's volume, and whose order they are. Before 043
// is run the racks still load, without floors.
// =============================================================================
export async function loadSlots() {
  const { data: racks, error } = await withNewColumns((withFloors) => supabase
    .from('warehouse_racks')
    .select(`id, rack_id, name, location, section, is_active, is_occupied, capacity_cbm${withFloors ? ', floor, is_simulated' : ''}`)
    .order('rack_id', { ascending: true }), ['floor', 'is_simulated'])

  if (error) throw error

  const { data: held, error: heldError } = await supabase
    .from('purchase_order_item_racks')
    .select(`
      warehouse_rack_id,
      quantity,
      purchase_order_item_id,
      purchase_order_items (
        id,
        product_id,
        products ( product_name, cbm, unit ),
        purchase_orders ( customer_order_id, customer_orders ( order_number ) )
      )
    `)

  if (heldError) throw heldError

  const contentsOf = {}
  for (const entry of held || []) {
    const line = entry.purchase_order_items
    const po = line?.purchase_orders
    ;(contentsOf[entry.warehouse_rack_id] ||= []).push({
      lineId: entry.purchase_order_item_id,
      quantity: Number(entry.quantity || 0),
      cbm: Number(line?.products?.cbm || 0),
      product: line?.products?.product_name || 'A product',
      unit: line?.products?.unit || 'cases',
      orderId: po?.customer_order_id || null,
      orderNumber: po?.customer_orders?.order_number || null,
    })
  }

  return (racks || []).map((rack) => ({
    ...rack,
    floor: rack.floor ?? null,
    contents: contentsOf[rack.id] || [],
  }))
}
