import { supabase } from '../supabase'
import { loadStatusHistory } from './predictionService'
import { allRows, estimateOrders, loadAllDeliveries, loadArrivals, loadLabelSteps, loadLabelingKinds, loadModels, loadOpenDeliveries } from '../utils/estimateLoader'
import { buildStageStatistics, normalizeStatus } from '../utils/predictions'
import {
  MIN_ACCURACY_ORDERS,
  accuracyCheck,
  aheadNumbers,
  busyMonths,
  daysAtSea,
  comingUpByWeek,
  finishedForAccuracy,
  headlineNumbers,
  labelingCheck,
  ordersAhead,
  shippingOnTimeByMonth,
  stepTimes,
  supplierLeadTimes,
  supplierOnTime,
} from '../utils/analytics'
import { isSimulated } from '../utils/simulated'
import { demandForecast, withProductTiming } from '../utils/demandForecast'
import { productTiming, reorderTiming } from '../utils/reorderTiming'
import { labelingPieceTimes, labelingRecords } from '../utils/labelingSteps'


// =============================================================================
// Predictive analytics — loading the data
//
// One load for the Predictive Analytics page, and for the Executive Dashboard's
// four numbers. The maths is in utils/analytics.js and utils/demandForecast.js.
// Each role's view asks only for its parts.
//
// The predictions, what's ahead:
//   ahead       the numbers at the top: orders on track, shipping soon,
//               deliveries likely late, cases expected this month, customers
//               due to order, accuracy
//   orders      each order under way: when it should ship and arrive, at risk
//   deliveries  each supplier delivery still to come: when, likely late
//   weeks       orders ready to ship, by week
//   reorders    when each customer will likely order next
//   demand      the demand forecast, with sales by product and each
//               product's orders and how often it's ordered
//   accuracy    how close the estimates came on orders they didn't learn from,
//               and the ready date of orders in labeling
// What the predictions learn from (descriptive):
//   steps       where the time goes, days at sea by country
//   labels      how long each piece of labeling takes, from the labels' steps
//   suppliers   on-time rate, lead time and busy months
//   months      shipping on time, by month
// And for the Executive Dashboard:
//   numbers     its four numbers
// =============================================================================

export const PREDICTION_PARTS = ['ahead', 'orders', 'deliveries', 'weeks', 'reorders', 'demand', 'accuracy']
export const HISTORY_PARTS = ['steps', 'labels', 'suppliers', 'months']
export const ALL_PARTS = [...PREDICTION_PARTS, ...HISTORY_PARTS]

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
  const needOrders = ['ahead', 'orders', 'numbers', 'steps', 'months', 'weeks', 'accuracy', 'demand', 'reorders', 'labels'].some(want)

  const [history, deliveries, suppliers, orders, models] = await Promise.all([
    needOrders ? loadStatusHistory() : [],
    loadAllDeliveries(supabase).catch(() => []),
    supabase.from('suppliers').select('id, supplier_name').order('supplier_name'),
    needOrders
      ? allRows(() => supabase.from('customer_orders').select('id, order_number, status, created_at, requested_ship_date, delivery_location_id, customer_id, container_size').order('id'))
      : Promise.resolve([]),
    // Every saved model, in use or not, for the accuracy check and the method note.
    loadModels(supabase, { inUseOnly: false }),
  ])

  if (suppliers.error) throw suppliers.error

  const allOrders = orders
  const supplierList = suppliers.data || []
  const names = Object.fromEntries(supplierList.map((supplier) => [supplier.id, supplier.supplier_name]))
  const { stageStatistics, historyByOrder, finishedOrders } = buildStageStatistics(history)

  // The estimates of the orders not shipped yet.
  let predictions = []
  if (['weeks', 'numbers', 'ahead', 'orders'].some(want)) {
    const open = allOrders.filter((order) => !CLOSED.includes(normalizeStatus(order.status)))
    predictions = (await estimateOrders(supabase, open, history)).predictions
  }

  // The supplier deliveries still to come, with when each should arrive.
  const openDeliveries = want('deliveries') || want('ahead')
    ? await loadOpenDeliveries(supabase).catch(() => [])
    : null

  // The labels' steps (db/migrations/026), with every order's kind and lines,
  // for the accuracy checks and the "Labeling steps" chart.
  const needLabels = ['accuracy', 'numbers', 'ahead', 'labels'].some(want)
  const [labeling, labelRows] = needLabels
    ? await Promise.all([loadLabelingKinds(supabase), loadLabelSteps(supabase)])
    : [null, null]
  const labels = labelRows ? { ...labelRows, items: labeling.items, orders: labeling.orders } : null

  // The accuracy check needs the finished orders' items and countries, once
  // there are enough of them.
  let accuracy = null
  if (['accuracy', 'numbers', 'ahead'].some(want)) {
    const finished = finishedForAccuracy(allOrders, historyByOrder)

    if (finished.length >= MIN_ACCURACY_ORDERS) {
      const [items, locations] = await Promise.all([
        rowsByIds('customer_order_items', 'customer_order_id, quantity, products ( supplier_id )', 'customer_order_id', finished.map(({ order }) => order.id)),
        rowsByIds('delivery_locations', 'id, country', 'id', [...new Set(finished.map(({ order }) => order.delivery_location_id).filter(Boolean))]),
      ])
      accuracy = accuracyCheck({ orders: allOrders, history, items, locations, deliveries, names, models, kinds: labeling.kinds, labels })
    } else {
      accuracy = { enough: false, finished: finished.length, needed: MIN_ACCURACY_ORDERS }
    }

    // The ready date of orders in labeling, from their labels' steps.
    if (want('accuracy')) accuracy.labeling = labelingCheck({ history, labels, kinds: labeling.kinds })
  }

  // The customers' names, for the next-order list and each product's orders.
  const customerNames = ['reorders', 'demand'].some(want)
    ? Object.fromEntries((await rowsByIds('profiles', 'id, name, company', 'id', [...new Set(allOrders.map((order) => order.customer_id).filter(Boolean))]).catch(() => []))
      .map((customer) => [customer.id, customer]))
    : {}

  // The demand forecast and sales by product: every order's lines and each
  // product's category. And each product's orders and how often it's ordered.
  let demand = null
  let orderItems = null
  if (want('demand') || want('ahead')) {
    const [items, products] = await Promise.all([
      allRows(() => supabase.from('customer_order_items').select('id, customer_order_id, product_id, quantity, unit_price, subtotal').order('id')),
      allRows(() => supabase.from('products').select('id, category, product_name').order('id')),
    ])
    orderItems = items
    demand = demandForecast({ orders: allOrders, items, products })

    if (want('demand') && demand.enough) {
      // Who orders each product, with when each of them is likely to order next.
      const nextOrders = new Map(reorderTiming({ orders: allOrders, items }).customers.map((customer) => [customer.id, customer]))
      const nameOf = (id) => customerNames[id]?.company || customerNames[id]?.name || null
      const timing = productTiming({ orders: allOrders, items })
      for (const entry of timing.products.values()) {
        entry.list = entry.list.map((line) => ({ ...line, customer: nameOf(line.customerId) }))
        entry.buyers = entry.buyers.map((buyer) => {
          const next = nextOrders.get(buyer.customerId)
          return { ...buyer, customer: nameOf(buyer.customerId), nextOrder: next ? { expectedDay: next.expectedDay, range: next.range, state: next.state } : null }
        })
      }
      demand.productSales = withProductTiming(demand.productSales, timing, products)
    }
  }

  // When each customer will likely order next, from the days between its orders.
  let reorders = null
  if (want('reorders') || want('ahead')) {
    reorders = reorderTiming({ orders: allOrders, customers: want('reorders') ? customerNames : {}, items: orderItems })
  }

  // How long each piece of labeling takes, from every finished order's labels
  // (db/migrations/026): the same numbers the estimates go by.
  let labelSteps = null
  if (want('labels')) {
    const { statistics } = labelingRecords({ ...labels, historyByOrder, kindOf: labeling.kindOf })
    const available = await supabase.from('label_exchange_history').select('id').limit(1).then(({ error }) => !error)
    labelSteps = { available, steps: labelingPieceTimes(statistics) }
  }

  // Each order under way, with its customer.
  let orderList = null
  if (want('orders')) {
    const customerIds = [...new Set(predictions.map((prediction) => prediction.customer_id).filter(Boolean))]
    const customers = await rowsByIds('profiles', 'id, name, company', 'id', customerIds).catch(() => [])
    orderList = ordersAhead(predictions, Object.fromEntries(customers.map((customer) => [customer.id, customer])))
  }

  return {
    // The predictions.
    ahead: want('ahead') ? aheadNumbers({ predictions, deliveries: openDeliveries, demand, accuracy, reorders }) : null,
    orders: orderList,
    deliveries: want('deliveries') ? openDeliveries : null,
    weeks: want('weeks') ? comingUpByWeek(predictions) : null,
    reorders: want('reorders') ? reorders : null,
    demand: want('demand') ? demand : null,
    accuracy: want('accuracy') ? accuracy : null,
    // What they learn from.
    steps: want('steps') ? stepTimes(stageStatistics) : null,
    // Days at sea by country, from recorded arrivals (db/migrations/025).
    atSea: want('steps') ? daysAtSea((await loadArrivals(supabase, history)).records) : null,
    labelSteps,
    onTime: want('suppliers') ? supplierOnTime(deliveries, supplierList) : null,
    leadTimes: want('suppliers') ? supplierLeadTimes(deliveries, supplierList) : null,
    // The busy months the deliveries show, which the estimates add for suppliers not ordered from yet.
    busyMonths: want('suppliers') ? busyMonths(deliveries) : null,
    months: want('months') ? shippingOnTimeByMonth(allOrders, historyByOrder) : null,
    // The Executive Dashboard's four numbers.
    numbers: want('numbers') ? headlineNumbers({ predictions, orders: allOrders, historyByOrder, deliveries, accuracy }) : null,
    learnedFrom: finishedOrders,
    // The saved models: how each did, whether it's in use, when it was trained.
    models: { available: models.available, rows: models.rows },
    // The made-up demo history is in (db/demo/), so the figures aren't DMC's own.
    simulated: allOrders.some((order) => isSimulated(order.order_number)) || deliveries.some((delivery) => isSimulated(delivery.poNumber)),
  }
}
