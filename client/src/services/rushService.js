import { supabase } from '../supabase'
import { RUSH_ITEM_COLUMNS, isMissingColumn } from '../utils/newColumns'
import { shipsInThisContainer } from '../utils/rushLines'


// =============================================================================
// Rush shipments (db/migrations/034)
//
// When some of an order's goods haven't arrived, its customer can ask for what
// is in DMC's warehouse to ship now; the rest waits, and goes in the container
// of their next order. Every step is the database's own: what can be rushed,
// what the customer is shown, and agreeing (only to exactly what was shown).
// The agreement is recorded by the database and can't be changed.
//
// Until the script is run, these say nothing can be rushed and nothing waits,
// so every page works as before.
// =============================================================================

// The step or table isn't there yet (db/migrations/034 not run).
export const rushNotReady = (error) =>
  ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code)
  || /my_rush_options|rush_shipment_preview|agree_rush_shipment|waiting_goods|order_rush_agreements/.test(error?.message || '')

const NOT_READY_MESSAGE = 'Rush shipments need db/migrations/034 to be run first.'


// The customer's orders that can be rushed now, with how many cases are in and
// how many would wait: Map of order id → { casesNow, casesWaiting }.
export async function loadMyRushOptions() {
  const { data, error } = await supabase.rpc('my_rush_options')

  if (error) {
    if (rushNotReady(error)) return new Map()
    throw error
  }

  return new Map((data || []).map((row) => [row.customer_order_id, {
    casesNow: Number(row.cases_now || 0),
    casesWaiting: Number(row.cases_waiting || 0),
  }]))
}


// What would ship now and what would wait, the words to agree to, and the
// fingerprint of exactly this. Refused (with the reason) if it can't be rushed.
export async function loadRushPreview(orderId) {
  const { data, error } = await supabase.rpc('rush_shipment_preview', { p_customer_order_id: orderId })

  if (error) throw new Error(rushNotReady(error) ? NOT_READY_MESSAGE : error.message || 'The rush shipment could not be loaded.')

  return data
}


// Agrees to the rush shipment exactly as shown (the preview's fingerprint).
// Refused if anything changed since, or it can't be rushed any more.
export async function agreeRushShipment(orderId, fingerprint) {
  const { data, error } = await supabase.rpc('agree_rush_shipment', {
    p_customer_order_id: orderId,
    p_fingerprint: fingerprint,
  })

  if (error) {
    const failure = new Error(rushNotReady(error) ? NOT_READY_MESSAGE : error.message || 'The rush shipment could not be agreed.')
    failure.changed = /Something changed since you opened this/.test(error.message || '')
    throw failure
  }

  return data
}


// The agreements on these orders: Map of order id → the agreement, as recorded.
export async function loadRushAgreements(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))]
  if (!ids.length) return new Map()

  const agreements = new Map()
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase
      .from('order_rush_agreements')
      .select('customer_order_id, customer_id, agreed_by_name, agreed_at, terms, lines, cases_now, cases_waiting')
      .in('customer_order_id', ids.slice(start, start + 100))

    if (error) {
      if (rushNotReady(error)) return new Map()
      throw error
    }

    for (const row of data || []) agreements.set(row.customer_order_id, row)
  }

  return agreements
}


// A customer's goods waiting from rush shipments: each line's cases still to
// ship, which earlier order they're from, and the order they joined, if any.
// Their own, or (staff) any customer's.
export async function loadWaitingGoods(customerId) {
  if (!customerId) return []

  const { data, error } = await supabase.rpc('waiting_goods', { p_customer_id: customerId })

  if (error) {
    if (rushNotReady(error)) return []
    throw error
  }

  return data || []
}


// Staff: every customer's waiting goods, for the customers with an agreement.
export async function loadAllWaitingGoods() {
  const { data, error } = await supabase.from('order_rush_agreements').select('customer_id')

  if (error) {
    if (rushNotReady(error)) return []
    throw error
  }

  const customers = [...new Set((data || []).map((row) => row.customer_id))]
  const lists = await Promise.all(customers.map((customerId) =>
    loadWaitingGoods(customerId).then((rows) => rows.map((row) => ({ ...row, customer_id: customerId })))))

  return lists.flat()
}


// The order each carried line is from: Map of the earlier line's id → its
// order number (for quotation and order lines with carried_from_item_id).
export async function loadCarriedFrom(items) {
  const ids = [...new Set((items || []).map((item) => item.carried_from_item_id).filter(Boolean))]
  if (!ids.length) return new Map()

  const { data, error } = await supabase
    .from('customer_order_items')
    .select('id, customer_orders ( order_number )')
    .in('id', ids)

  if (error) return new Map()
  return new Map((data || []).map((row) => [row.id, row.customer_orders?.order_number || null]))
}


// Order lines with cases going in their order's container, with how many
// (ship_quantity) and whether they're carried from an earlier order. A rushed
// order's lines that all wait for the next order aren't labeled, loaded or
// packed with it. Before 034 is run, every line, as before.
export async function linesShippingNow(items) {
  const list = items || []
  if (!list.length) return list

  const details = new Map()
  for (let start = 0; start < list.length; start += 100) {
    const { data, error } = await supabase
      .from('customer_order_items')
      .select('id, ship_quantity, carried_from_item_id, po_item_id')
      .in('id', list.slice(start, start + 100).map((item) => item.id))

    if (error) {
      if (isMissingColumn(error, [...RUSH_ITEM_COLUMNS, 'po_item_id'])) return list
      throw error
    }

    for (const row of data || []) details.set(row.id, row)
  }

  return list
    .map((item) => ({
      ...item,
      ship_quantity: details.get(item.id)?.ship_quantity ?? null,
      carried_from_item_id: details.get(item.id)?.carried_from_item_id ?? null,
      po_item_id: details.get(item.id)?.po_item_id ?? null,
    }))
    .filter(shipsInThisContainer)
}


// Where a waiting line is now:
//   'waiting'  waits for the customer's next order (none has taken it yet)
//   'joined'   goes in the container of carried_into (not shipped yet)
//   'left'     left with carried_into: shipped (any cases that wait again are
//              that order's own waiting goods)
//   'given'    DMC's: no approved order took it within its 2 weeks
//              (db/migrations/039, 041)
export function waitingState(row) {
  if (row?.given_at) return 'given'
  if (!row?.carried_into) return 'waiting'
  const status = String(row.carried_into_status || '').trim().toLowerCase()
  if (status === 'shipped' || status === 'partly shipped') return 'left'
  if (status === 'cancelled') return 'waiting'
  return 'joined'
}

// Still to ship: waiting, or joined to an order that hasn't shipped.
export const stillToShip = (rows) => (rows || []).filter((row) => !['left', 'given'].includes(waitingState(row)))

// The last day the next order can be approved to take a waiting line (2 weeks
// from when the goods were all in and the rushed order's container left; 041),
// or null when that hasn't started yet. As "Nov 20, 2026".
export const deadlineText = (row) => (row?.deadline
  ? new Date(`${String(row.deadline).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : null)

// The last day a quotation with waiting goods in it can be approved (041): the
// soonest last day of the waiting goods it carries, as YYYY-MM-DD, or null.
// items: the quotation's lines; rows: the customer's waiting_goods rows.
export function approveByOf(items, rows) {
  const carried = new Set((items || []).map((item) => item.carried_from_item_id).filter(Boolean))
  const days = (rows || [])
    .filter((row) => carried.has(row.item_id) && row.deadline)
    .map((row) => String(row.deadline).slice(0, 10))
    .sort()
  return days[0] || null
}

// How many cases and products, of these lines.
export function countOf(rows) {
  const list = rows || []
  return {
    cases: list.reduce((sum, row) => sum + Number(row.cases || 0), 0),
    products: new Set(list.map((row) => row.product_id)).size,
    orders: [...new Set(list.map((row) => row.order_number).filter(Boolean))],
  }
}
