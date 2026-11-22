// =============================================================================
// Order lines after a rush shipment (db/migrations/034)
//
// A rushed order's line ships only the cases that were in DMC's warehouse when
// the customer agreed (ship_quantity; empty = all of it, as for every other
// order). The rest waits, and joins the customer's next order as a line of its
// own at US$0, carried from the first (carried_from_item_id). Pure, no imports.
// =============================================================================

// Cases of the line in this order's container.
export const casesShipping = (item) =>
  item?.ship_quantity === null || item?.ship_quantity === undefined
    ? Number(item?.quantity || 0)
    : Number(item.ship_quantity)

// Cases of the line waiting for the customer's next order.
export const casesWaiting = (item) => Math.max(0, Number(item?.quantity || 0) - casesShipping(item))

// The line has something in this order's container (labels, loading, the
// packing list): every line of an order that wasn't rushed.
export const shipsInThisContainer = (item) => casesShipping(item) > 0

// Each line's order number, by line id, from orders with their lines: to name
// the order a carried line is from.
export function orderNumberByItem(orders = []) {
  const numbers = new Map()
  for (const order of orders || []) {
    for (const item of order?.customer_order_items || []) numbers.set(item.id, order.order_number)
  }
  return numbers
}

// What to say under a line: carried from an earlier order, or how much of it
// ships now / waits. forStaff words it for DMC.
export function lineNote(item, fromOrder = null, { forStaff = false } = {}) {
  const carried = item?.carried_from_item_id
    ? `From ${fromOrder || 'an earlier order'} (already paid; waited for this container)`
    : null

  const waits = casesWaiting(item)
  if (!waits) return carried

  const ships = casesShipping(item)
  const next = forStaff ? "the customer's next order" : 'your next order'
  const split = ships > 0
    ? `${ships.toLocaleString()} ship with this order; ${waits.toLocaleString()} wait for ${next}`
    : `All ${waits.toLocaleString()} wait for ${next}`
  return carried ? `${carried} · ${split}` : split
}
