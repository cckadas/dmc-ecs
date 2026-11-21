import { supabaseAdmin } from '../supabaseAdmin.js'
import { customerViewOf } from '../estimates.js'
import { describePayment } from './describe.js'
import { CANCELLATION_COLUMNS, RUSH_ITEM_COLUMNS, columnsIf, withNewColumns } from '../../client/src/utils/newColumns.js'
import { casesShipping, casesWaiting } from '../../client/src/utils/rushLines.js'
import { hasShipped, lastShipEntry } from '../../client/src/utils/orderShipping.js'


// =============================================================================
// The customer's own data, for the DMC Order Assistant
//
// Built on the server with the service-role client, so EVERY query here must
// filter by the signed-in customer's id. Contains no supplier names, supplier
// prices, costs or markups, and no personal contact details (email, phone,
// address), since this is sent to the AI provider.
// =============================================================================

const MAX_ORDERS = 10
const MAX_ITEMS = 15
const MAX_PRODUCTS = 8

const peso = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Timestamps are shown in Philippine time; date-only values as written.
const formatTimestamp = (value) =>
  value ? new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : null

const formatDateOnly = (value) =>
  value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null

const todayInManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

const addDays = (dateOnly, days) => {
  const date = new Date(`${String(dateOnly).slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const label = (status) => {
  const text = String(status || '').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown'
}

// "20 case" → "20 cases", "10 Box" → "10 Boxes"; "pcs" is already plural.
const quantityText = (count, unit) => {
  const name = unit || 'unit'
  if (Number(count) === 1 || /s$/i.test(name)) return `${count} ${name}`
  return `${count} ${name}${/(x|z|ch|sh)$/i.test(name) ? 'es' : 's'}`
}

const productName = (product) =>
  product ? (product.pack_size && product.family ? `${product.family} (${product.pack_size})` : product.product_name) : 'Product'


// The tracker's steps and the shared prediction maths come from the website's
// own files, so the chatbot always matches the order progress tracker. Loaded
// lazily: if they're missing, the assistant still works, without dates.
let sharedModules = null

async function loadSharedModules() {
  if (sharedModules) return sharedModules

  try {
    const [predictions, progress] = await Promise.all([
      import(new URL('../../client/src/utils/predictions.js', import.meta.url).href),
      import(new URL('../../client/src/utils/orderProgress.js', import.meta.url).href),
    ])
    sharedModules = { predictions, progress }
  } catch (error) {
    console.warn('Order assistant: shared progress code unavailable.', error.code || error.message)
    sharedModules = { predictions: null, progress: null }
  }

  return sharedModules
}


async function must(promise, what) {
  const { data, error } = await promise
  if (error) {
    const failure = new Error(`Order assistant could not load ${what}.`)
    failure.cause = error
    throw failure
  }
  return data || []
}


// Words in the question that could be part of a product name.
const STOP_WORDS = new Set([
  'what', 'whats', 'which', 'when', 'where', 'how', 'many', 'much', 'the', 'and', 'for', 'are', 'is', 'can',
  'could', 'would', 'does', 'did', 'you', 'your', 'my', 'our', 'have', 'has', 'any', 'there', 'about', 'with',
  'minimum', 'order', 'orders', 'moq', 'available', 'availability', 'stock', 'product', 'products', 'price',
  'prices', 'buy', 'want', 'need', 'please', 'tell', 'show', 'still', 'this', 'that', 'from', 'case', 'cases',
  'size', 'sizes', 'pack', 'unit', 'units', 'quantity', 'request', 'quotation', 'payment', 'pay', 'paid',
  'will', 'status', 'ready', 'arrive', 'arriving', 'ship', 'shipped', 'shipping', 'shipment', 'deliver',
  'delivered', 'delivery', 'know', 'like', 'also', 'just', 'they', 'them', 'their', 'than', 'then', 'here',
  'been', 'being', 'were', 'was', 'into', 'over', 'more', 'most', 'some', 'only', 'other', 'same', 'very',
  'yours', 'hello', 'thanks', 'thank', 'help', 'balance', 'owe', 'due', 'deadline', 'date', 'dates', 'today',
  'tomorrow', 'week', 'days', 'verified', 'verify', 'track', 'tracking', 'progress', 'step', 'steps',
  'label', 'labels', 'document', 'documents', 'pfi', 'invoice', 'credit', 'limit', 'account', 'customer',
  'dmc', 'long', 'take', 'takes', 'expire', 'expires', 'expiry', 'valid', 'approve', 'reject', 'rejected',
  'overdue', 'left', 'next', 'last', 'first', 'second', 'down', 'full', 'fully', 'total', 'much', 'should',
])

function productSearchTerms(message) {
  return [...new Set(
    message.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/)
      .map((word) => word.replace(/^'+|'+$/g, ''))
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && /^[a-z0-9'-]+$/.test(word))
  )].slice(0, 5)
}

async function findMentionedProducts(message) {
  const terms = productSearchTerms(message)
  if (terms.length === 0) return []

  const filter = terms.map((term) => `product_name.ilike.%${term.replace(/'/g, '')}%`).join(',')
  const products = await must(
    supabaseAdmin
      .from('products')
      .select('id, product_name, family, pack_size, unit, availability, supplier_id')
      .or(filter)
      .limit(60),
    'products'
  )

  // Most matching words first.
  const ranked = products
    .map((product) => ({
      product,
      score: terms.filter((term) => product.product_name.toLowerCase().includes(term)).length,
    }))
    .sort((a, b) => b.score - a.score || a.product.product_name.localeCompare(b.product.product_name))
    .slice(0, MAX_PRODUCTS)
    .map((entry) => entry.product)

  if (ranked.length === 0) return []

  // The minimum order is the supplier's MOQ — sent without any price.
  const prices = await must(
    supabaseAdmin
      .from('supplier_price_list')
      .select('product_id, supplier_id, min_order_qty')
      .in('product_id', ranked.map((product) => product.id))
      .is('effective_to', null),
    'minimum order quantities'
  )

  return ranked.map((product) => {
    const listed = prices.find((row) => row.product_id === product.id && row.supplier_id === product.supplier_id)
    return {
      product: productName(product),
      packSize: product.pack_size || null,
      unit: product.unit || null,
      minimumOrder: listed?.min_order_qty ? quantityText(listed.min_order_qty, product.unit) : 'no minimum',
      available: String(product.availability || '').toLowerCase() !== 'unavailable',
    }
  })
}


export async function buildCustomerContext(customerId, message) {
  const today = todayInManila()
  const { predictions, progress } = await loadSharedModules()

  const [profiles, orders, requests, history, settings] = await Promise.all([
    // Whether DMC stopped their new orders (038): asked again without it until that's run.
    must(withNewColumns((withAccount) => supabaseAdmin
      .from('profiles')
      .select(`name, company${withAccount ? ', new_orders_stopped_at' : ''}`)
      .eq('id', customerId)
      .limit(1), ['new_orders_stopped_at']), 'profile'),
    // When and why an order was cancelled (028), and what a rush shipment
    // split (034): asked again without them until those scripts are run.
    must(
      withNewColumns((withRush) => withNewColumns((withCancellation) => supabaseAdmin
        .from('customer_orders')
        .select(`
          id, order_number, quotation_number, status, created_at, requested_ship_date, delivery_location_id, expiry_date,
          ${columnsIf(withCancellation, CANCELLATION_COLUMNS)}
          total_amount, down_payment_amount, settled_amount, pending_payment_amount, rejection_reason,
          pfi_file_path, pack_list_path, cert_shipment_path, cert_clearance_path,
          customer_order_items ( id, quantity, unit_price, subtotal, ${columnsIf(withRush, RUSH_ITEM_COLUMNS)} products ( product_name, family, pack_size, unit ) )
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }), CANCELLATION_COLUMNS), RUSH_ITEM_COLUMNS),
      'orders'
    ),
    must(
      supabaseAdmin
        .from('quotation_requests')
        .select('id, quotation_reference, status, created_at, preferred_ship_date, quotation_request_items ( quantity, products ( product_name, family, pack_size, unit ) )')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
      'quotation requests'
    ),
    // Every order's history, for the prediction statistics; only this
    // customer's predictions are ever sent.
    predictions
      ? must(supabaseAdmin.from('customer_order_status_history').select('customer_order_id, previous_status, new_status, changed_at').order('changed_at', { ascending: true }), 'status history')
      : Promise.resolve([]),
    must(supabaseAdmin.from('business_settings').select('key, value').eq('key', 'credit_limit'), 'credit limit'),
  ])

  const quotations = requests.length
    ? await must(
        supabaseAdmin
          .from('quotations')
          .select('quotation_request_id, quotation_number, status, expiry_date, total_amount, down_payment_amount, shipping_cost, container_size, container_cost, created_at')
          .in('quotation_request_id', requests.map((request) => request.id))
          .order('created_at', { ascending: false }),
        'quotations'
      )
    : []

  // Past quotations and requests stay on record, so the open ones come first.
  const isOpenRequest = (request) => !['approved', 'rejected', 'cancelled', 'expired'].includes(String(request.status).trim().toLowerCase())
  const openRequests = requests.filter(isOpenRequest)
  const closedRequests = requests.filter((request) => !isOpenRequest(request))
  const isOpenQuotation = (quotation) => String(quotation.status).trim().toLowerCase() === 'pending approval'
  const openQuotations = quotations.filter(isOpenQuotation)
  const closedQuotations = quotations.filter((quotation) => !isOpenQuotation(quotation))

  const stats = predictions ? predictions.buildStageStatistics(history) : null

  // An order the customer named explicitly is always included.
  const mentioned = orders.filter((order) => order.order_number && message.toUpperCase().includes(order.order_number.toUpperCase()))
  const shownOrders = [...new Set([...mentioned, ...orders.slice(0, MAX_ORDERS)])]

  // Compliance label progress for those orders' items (all this customer's).
  const itemIds = shownOrders.flatMap((order) => (order.customer_order_items || []).slice(0, MAX_ITEMS).map((item) => item.id))
  const labelExchanges = itemIds.length
    ? await must(
        supabaseAdmin.from('compliance_label_exchanges').select('customer_order_item_id, status').in('customer_order_item_id', itemIds),
        'compliance labels'
      )
    : []

  // Each order's ship date estimate, the same as My Orders shows. Worked out
  // from all of DMC's records (server/estimates.js), but only the customer-safe
  // part comes back: dates and plain words, never suppliers or reasons.
  let shipEstimates = {}
  if (predictions) {
    try {
      const views = await customerViewOf(shownOrders, history)
      shipEstimates = Object.fromEntries(views.map((view) => [view.orderId, view]))
    } catch (error) {
      console.warn('Order assistant: ship date estimates unavailable.', error.message)
    }
  }

  // Rush shipments (034): which order took each waiting line, and what still
  // waits for the customer's next order.
  const takenBy = new Map()
  for (const other of orders) {
    for (const line of other.customer_order_items || []) {
      if (line.carried_from_item_id) takenBy.set(line.carried_from_item_id, other)
    }
  }
  const orderNumberOfItem = new Map(orders.flatMap((other) => (other.customer_order_items || []).map((line) => [line.id, other.order_number])))
  const waitingFor = (item) => {
    const next = takenBy.get(item.id)
    if (!next) return 'your next order (not placed yet)'
    return hasShipped(next.status) ? null : next.order_number
  }
  const goodsWaiting = orders.flatMap((other) => (other.customer_order_items || [])
    .filter((item) => casesWaiting(item) > 0 && waitingFor(item))
    .map((item) => ({
      product: productName(item.products),
      cases: quantityText(casesWaiting(item), item.products?.unit),
      fromOrder: other.order_number,
      goesWith: waitingFor(item),
    })))

  const orderContext = shownOrders.map((order) => {
    const status = String(order.status || '').trim().toLowerCase()
    const total = Number(order.total_amount || 0)
    const settled = Number(order.settled_amount || 0)
    const pending = Number(order.pending_payment_amount || 0)
    // DMC's rule (db/migrations/028): the down payment is due 7 days after the
    // quotation expires, can still be paid for 7 days after that, and the order
    // is cancelled the day after.
    const deadline = order.expiry_date ? addDays(order.expiry_date, 7) : null
    const lastDay = deadline ? addDays(deadline, 7) : null
    const cancelOn = lastDay ? addDays(lastDay, 1) : null
    const cancelled = status === 'cancelled'
    const nothingSent = settled <= 0 && pending <= 0
    const orderHistory = stats ? (stats.historyByOrder[order.id] || []) : []
    const items = (order.customer_order_items || []).slice(0, MAX_ITEMS)

    // As on the Payments page: a rejected down payment sets the order's
    // status; a rejected balance payment only leaves its reason. Either way it
    // no longer applies once a new payment is awaiting verification.
    const rejected = !cancelled && pending <= 0 && (status === 'payment rejected' || (settled > 0 && Boolean(order.rejection_reason)))

    const labels = items.map((item) => {
      const exchange = labelExchanges.find((entry) => entry.customer_order_item_id === item.id)
      return { product: productName(item.products), status: exchange ? label(exchange.status) : 'Not started yet' }
    })

    let progressInfo = { status: label(status) }

    if (cancelled) {
      progressInfo = {
        status: 'Cancelled',
        cancelledOn: formatTimestamp(order.cancelled_at),
        reason: order.cancellation_reason || null,
      }
    } else if (progress) {
      const done = progress.stepsDone(status)
      const dates = progress.stepDates(order, orderHistory)
      progressInfo = {
        status: label(status),
        step: `Step ${done} of ${progress.ORDER_STEPS.length}`,
        completedSteps: progress.ORDER_STEPS.slice(0, done).map((step, index) => ({
          step: step.label,
          on: dates[index] ? formatTimestamp(dates[index]) : null,
        })),
        nextStep: progress.ORDER_STEPS[done]?.label || null,
      }
    }

    const view = shipEstimates[order.id]
    let estimate = null
    if (view && !view.shipped && view.estimatedShipDate) {
      estimate = {
        shipsAround: formatTimestamp(view.estimatedShipDate),
        likelyBetween: view.shipDateRange
          ? `${formatTimestamp(view.shipDateRange.quick)} and ${formatTimestamp(view.shipDateRange.slow)}`
          : null,
        arrivalAtYourPort: formatTimestamp(view.estimatedArrivalDate),
        onlyIfDownPaymentIsPaidToday: view.ifPaidToday,
        requestedShipDate: formatDateOnly(view.requestedShipDate),
        comparedWithRequestedDate: view.customerNote,
        roughEstimate: view.roughEstimate,
        note: 'An estimate based on past orders, not a confirmed or guaranteed date.',
      }
    }

    const payment = {
      orderTotal: peso(total),
      downPaymentRequired: peso(order.down_payment_amount),
      paidAndVerified: peso(settled),
      awaitingVerification: pending > 0 ? peso(pending) : null,
      balanceDue: peso(Math.max(total - settled, 0)),
      fullyPaid: total > 0 && settled >= total,
      downPaymentDeadline: deadline ? formatDateOnly(deadline) : null,
      downPaymentLastDay: lastDay ? formatDateOnly(lastDay) : null,
      cancelledIfUnpaidOn: cancelOn ? formatDateOnly(cancelOn) : null,
      // A payment already sent isn't late while DMC checks it.
      downPaymentOverdue: Boolean(!cancelled && deadline && deadline < today && nothingSent),
      downPaymentTooLate: Boolean(!cancelled && lastDay && lastDay < today && nothingSent),
      cancelled,
      cancelledOn: cancelled ? formatTimestamp(order.cancelled_at) : null,
      lastRejectionReason: rejected ? order.rejection_reason || 'No reason was given.' : null,
    }
    payment.inShort = describePayment(payment)

    return {
      orderNumber: order.order_number,
      quotationNumber: order.quotation_number,
      placedOn: formatTimestamp(order.created_at),
      progress: progressInfo,
      estimatedShipment: estimate,
      // The day its own container left (in full, or in part after a rush shipment).
      shippedOn: hasShipped(status) ? formatTimestamp(lastShipEntry(orderHistory)?.changed_at) : null,
      rushShipment: (order.customer_order_items || []).some((item) => item.ship_quantity !== null && item.ship_quantity !== undefined)
        ? {
            agreed: true,
            note: 'The customer agreed to a rush shipment: only the goods already in DMC\'s warehouse went in this order\'s container; the rest go in the container of their next order, already paid for.',
            casesInThisOrdersContainer: (order.customer_order_items || []).reduce((sum, item) => sum + casesShipping(item), 0),
            waitingGoods: (order.customer_order_items || []).filter((item) => casesWaiting(item) > 0).map((item) => ({
              product: productName(item.products),
              cases: quantityText(casesWaiting(item), item.products?.unit),
              goesWith: waitingFor(item) || 'already left with a later order',
            })),
          }
        : null,
      items: items.map((item) => ({
        product: productName(item.products),
        quantity: quantityText(item.quantity, item.products?.unit),
        unitPrice: peso(item.unit_price),
        lineTotal: peso(item.subtotal),
        ...(item.carried_from_item_id
          ? { fromEarlierOrder: `${orderNumberOfItem.get(item.carried_from_item_id) || 'an earlier order'} (rush shipment; already paid)` }
          : {}),
      })),
      payment,
      labels: {
        waitingForYourDesign: labels.filter((entry) => entry.status === 'Awaiting customer translated design').map((entry) => entry.product),
        items: labels,
      },
      documents: {
        quotationPfi: Boolean(order.pfi_file_path),
        packingList: Boolean(order.pack_list_path),
        certificateOfShipment: Boolean(order.cert_shipment_path),
        certificateOfClearance: Boolean(order.cert_clearance_path),
      },
    }
  })

  // A cancelled order owes nothing (028).
  const unpaid = orders
    .filter((order) => String(order.status || '').trim().toLowerCase() !== 'cancelled')
    .reduce((sum, order) => sum + Math.max(Number(order.total_amount || 0) - Number(order.settled_amount || 0), 0), 0)
  const creditLimit = settings[0]?.value == null ? null : Number(settings[0].value)

  return {
    today: formatDateOnly(today),
    customer: { name: profiles[0]?.name || null, company: profiles[0]?.company || null },
    // 038: DMC stopped this customer's new orders. They can pay and follow
    // their orders, but can't send requests, approve quotations, ask for a new
    // quote or a rush shipment.
    newOrders: profiles[0]?.new_orders_stopped_at
      ? 'stopped by DMC: the customer can pay and follow their current orders, but cannot send quotation requests, approve quotations, ask for a new quote or a rush shipment; they contact DMC about new orders'
      : 'open',
    totals: {
      orders: orders.length,
      ordersShown: orderContext.length,
      openQuotationRequests: openRequests.length,
    },
    orders: orderContext,
    // From rush shipments: already paid, they go in the container of the
    // customer's next order (goesWith: the order that has them, if placed).
    goodsWaitingForNextOrder: goodsWaiting,
    quotationRequests: [...openRequests, ...closedRequests].slice(0, MAX_ORDERS).map((request) => ({
      reference: request.quotation_reference,
      status: label(request.status),
      requestedOn: formatTimestamp(request.created_at),
      preferredShipDate: formatDateOnly(request.preferred_ship_date),
      items: (request.quotation_request_items || []).slice(0, MAX_ITEMS).map((item) => ({
        product: productName(item.products),
        quantity: quantityText(item.quantity, item.products?.unit),
      })),
    })),
    quotations: [...openQuotations, ...closedQuotations].slice(0, MAX_ORDERS).map((quotation) => ({
      quotationNumber: quotation.quotation_number,
      forRequest: requests.find((request) => request.id === quotation.quotation_request_id)?.quotation_reference || null,
      status: label(quotation.status),
      total: peso(quotation.total_amount),
      downPayment: peso(quotation.down_payment_amount),
      shipping: peso(quotation.shipping_cost),
      container: quotation.container_cost == null ? null : `${quotation.container_size}, ${peso(quotation.container_cost)}`,
      expiresOn: formatDateOnly(quotation.expiry_date),
      expired: Boolean(quotation.expiry_date && String(quotation.expiry_date).slice(0, 10) < today),
    })),
    credit: {
      unpaidBalance: peso(unpaid),
      creditLimit: creditLimit == null ? 'no limit set' : peso(creditLimit),
      canPlaceNewOrders: creditLimit == null || unpaid < creditLimit,
    },
    productsMentioned: await findMentionedProducts(message),
  }
}
