import { supabase } from '../supabase'
import { loadStatusHistory } from './predictionService'
import { estimateOrders, loadAllDeliveries, loadStartingValues } from '../utils/estimateLoader'
import { buildStageStatistics, normalizeStatus } from '../utils/predictions'
import { startingDaysFrom } from '../utils/estimateInputs'
import {
  MIN_ACCURACY_ORDERS,
  accuracyCheck,
  comingUpByWeek,
  finishedForAccuracy,
  headlineNumbers,
  shippingOnTimeByMonth,
  stepTimes,
  supplierLeadTimes,
  supplierOnTime,
} from '../utils/analytics'
import { isSimulated } from '../utils/simulated'


// =============================================================================
// Predictive analytics — loading the data
//
// One load for the Predictive Analytics page, and for the Executive Dashboard's
// four numbers. The maths is in utils/analytics.js. Each role's view asks only
// for its parts:
//   numbers    the four numbers
//   steps      1. where the time goes
//   suppliers  2. on-time rate and 3. lead time, by supplier
//   months     4. shipping on time, by month
//   weeks      5. coming up, by week
//   accuracy   6. prediction accuracy
// =============================================================================

export const ALL_PARTS = ['numbers', 'steps', 'suppliers', 'months', 'weeks', 'accuracy']

const CLOSED = ['shipped', 'cancelled']


// Rows by their ids, a hundred at a time, so a request never gets too long.
async function rowsByIds(table, columns, column, ids) {
  const rows = []

  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase.from(table).select(columns).in(column, ids.slice(index, index + 100))
    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}


export async function loadAnalytics(parts = ALL_PARTS) {
  const want = (part) => parts.includes(part)
  const needOrders = ['numbers', 'steps', 'months', 'weeks', 'accuracy'].some(want)

  const [history, starting, deliveries, suppliers, orders] = await Promise.all([
    needOrders ? loadStatusHistory() : [],
    loadStartingValues(supabase),
    loadAllDeliveries(supabase).catch(() => []),
    supabase.from('suppliers').select('id, supplier_name').order('supplier_name'),
    needOrders
      ? supabase.from('customer_orders').select('id, order_number, status, created_at, requested_ship_date, delivery_location_id')
      : Promise.resolve({ data: [] }),
  ])

  if (suppliers.error) throw suppliers.error
  if (orders.error) throw orders.error

  const allOrders = orders.data || []
  const supplierList = suppliers.data || []
  const names = Object.fromEntries(supplierList.map((supplier) => [supplier.id, supplier.supplier_name]))
  const startingDays = startingDaysFrom(starting.settings)
  const { stageStatistics, historyByOrder, finishedOrders } = buildStageStatistics(history)

  // The estimates of the orders not shipped yet: chart 5 and "orders on track".
  let predictions = []
  if (want('weeks') || want('numbers')) {
    const open = allOrders.filter((order) => !CLOSED.includes(normalizeStatus(order.status)))
    predictions = (await estimateOrders(supabase, open, history)).predictions
  }

  // The accuracy check needs the finished orders' items and countries, once
  // there are enough of them.
  let accuracy = null
  if (want('accuracy') || want('numbers')) {
    const finished = finishedForAccuracy(allOrders, historyByOrder)

    if (finished.length >= MIN_ACCURACY_ORDERS) {
      const [items, locations] = await Promise.all([
        rowsByIds('customer_order_items', 'customer_order_id, quantity, products ( supplier_id )', 'customer_order_id', finished.map(({ order }) => order.id)),
        rowsByIds('delivery_locations', 'id, country', 'id', [...new Set(finished.map(({ order }) => order.delivery_location_id).filter(Boolean))]),
      ])
      accuracy = accuracyCheck({ orders: allOrders, history, items, locations, deliveries, starting, names })
    } else {
      accuracy = { enough: false, finished: finished.length, needed: MIN_ACCURACY_ORDERS }
    }
  }

  return {
    numbers: want('numbers') ? headlineNumbers({ predictions, orders: allOrders, historyByOrder, deliveries, accuracy }) : null,
    steps: want('steps') ? stepTimes(stageStatistics, startingDays) : null,
    onTime: want('suppliers') ? supplierOnTime(deliveries, supplierList) : null,
    leadTimes: want('suppliers') ? supplierLeadTimes(deliveries, supplierList, starting.startingSuppliers, startingDays) : null,
    months: want('months') ? shippingOnTimeByMonth(allOrders, historyByOrder) : null,
    weeks: want('weeks') ? comingUpByWeek(predictions) : null,
    accuracy: want('accuracy') ? accuracy : null,
    learnedFrom: finishedOrders,
    // The made-up demo history is in (db/demo/), so the figures aren't DMC's own.
    simulated: allOrders.some((order) => isSimulated(order.order_number)) || deliveries.some((delivery) => isSimulated(delivery.poNumber)),
    // The starting values are still the stand-ins until DMC's numbers are saved
    // on Prediction Settings.
    placeholders: !starting.settings.length || starting.settings.some((row) => row.is_placeholder),
  }
}
