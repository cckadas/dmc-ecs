import { supabase } from '../supabase'


// =============================================================================
// Each product moves on as its own goods arrive (db/migrations/049)
//
// A product's label work starts once any of its cases are in: the warehouse
// takes the original label, sales sends it to the customer, the customer sends
// the design, and it's printed. Its labels are applied once all of its cases
// are in (or the rest is recorded as not coming), or, in a rush shipment, the
// cases shipping now. The order still waits for every product to move to
// warehouse preparation, and to ship.
// =============================================================================

// Orders whose arrived goods can be labeled: still waiting for some suppliers, or all in.
export const LABEL_ORDER_STATUSES = ['procurement', 'warehouse preparation']

// The items whose goods have arrived, at least partly, each with
// arrival: { ordered, received, missing, complete }. An item with nothing
// bought for it (goods already in the warehouse) has arrived. Before 049 is
// run, the items as they were.
export async function arrivedOnly(items = []) {
  if (!items?.length) return items || []

  const { data, error } = await supabase.rpc('order_items_arrival', {
    p_order_ids: [...new Set(items.map((item) => item.customer_order_id).filter(Boolean))],
  })

  if (error) {
    if (/42883|PGRST202|could not find|does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) return items
    throw error
  }

  const byItem = Object.fromEntries((data || []).map((row) => [row.item_id, row]))

  return items
    .map((item) => {
      const row = byItem[item.id]
      return {
        ...item,
        arrival: row
          ? { ordered: row.ordered, received: Number(row.received || 0), missing: Number(row.missing || 0), complete: Boolean(row.complete) }
          : { ordered: null, received: null, missing: 0, complete: true },
      }
    })
    .filter((item) => item.arrival.complete || item.arrival.received > 0)
}
