import { supabaseAdmin } from '../supabaseAdmin.js'
import { describePayment } from './describe.js'


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
    must(supabaseAdmin.from('profiles').select('name, company').eq('id', customerId).limit(1), 'profile'),
    must(
      supabaseAdmin
        .from('customer_orders')
        .select(`
          id, order_number, quotation_number, status, created_at, estimated_ship_date, expiry_date,
          total_amount, down_payment_amount, settled_amount, pending_payment_amount, rejection_reason,
          pfi_file_path, pack_list_path, cert_shipment_path, cert_clearance_path,
          customer_order_items ( id, quantity, unit_price, subtotal, products ( product_name, family, pack_size, unit ) )
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
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
      ? must(supabaseAdmin.from('customer_order_status_history').select('customer_order_id, new_status, changed_at').order('changed_at', { ascending: true }), 'status history')
      : Promise.resolve([]),
    must(supabaseAdmin.from('business_settings').select('key, value').eq('key', 'credit_limit'), 'credit limit'),
  ])

  const quotations = requests.length
    ? await must(
        supabaseAdmin
          .from('quotations')
          .select('quotation_request_id, quotation_number, status, expiry_date, total_amount, down_payment_amount, shipping_cost, created_at')
          .in('quotation_request_id', requests.map((request) => request.id)),
        'quotations'
      )
    : []

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

  const orderContext = shownOrders.map((order) => {
    const status = String(order.status || '').trim().toLowerCase()
    const total = Number(order.total_amount || 0)
    const settled = Number(order.settled_amount || 0)
    const pending = Number(order.pending_payment_amount || 0)
    const deadline = order.expiry_date ? addDays(order.expiry_date, 7) : null
    const orderHistory = stats ? (stats.historyByOrder[order.id] || []) : []
    const items = (order.customer_order_items || []).slice(0, MAX_ITEMS)

    // As on the Payments page: a rejected down payment sets the order's
    // status; a rejected balance payment only leaves its reason. Either way it
    // no longer applies once a new payment is awaiting verification.
    const rejected = pending <= 0 && (status === 'payment rejected' || (settled > 0 && Boolean(order.rejection_reason)))

    const labels = items.map((item) => {
      const exchange = labelExchanges.find((entry) => entry.customer_order_item_id === item.id)
      return { product: productName(item.products), status: exchange ? label(exchange.status) : 'Not started yet' }
    })

    let progressInfo = { status: label(status) }

    if (progress) {
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

    let estimate = null
    if (stats && status !== 'shipped') {
      const prediction = predictions.predictOrder(order, stats.stageStatistics, stats.historyByOrder)
      if (prediction.estimatedReadyDate) {
        estimate = {
          readyForShipmentBy: formatTimestamp(prediction.estimatedReadyDate),
          confidencePercent: prediction.confidence,
          note: 'An estimate based on past orders, not a confirmed or guaranteed date.',
        }
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
      // A payment already sent isn't late while DMC checks it.
      downPaymentOverdue: Boolean(deadline && deadline < today && settled <= 0 && pending <= 0),
      lastRejectionReason: rejected ? order.rejection_reason || 'No reason was given.' : null,
    }
    payment.inShort = describePayment(payment)

    return {
      orderNumber: order.order_number,
      quotationNumber: order.quotation_number,
      placedOn: formatTimestamp(order.created_at),
      progress: progressInfo,
      estimatedReady: estimate,
      shippedOn: status === 'shipped'
        ? formatTimestamp(orderHistory.filter((entry) => String(entry.new_status).toLowerCase() === 'shipped').at(-1)?.changed_at)
        : null,
      items: items.map((item) => ({
        product: productName(item.products),
        quantity: quantityText(item.quantity, item.products?.unit),
        unitPrice: peso(item.unit_price),
        lineTotal: peso(item.subtotal),
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

  const unpaid = orders.reduce(
    (sum, order) => sum + Math.max(Number(order.total_amount || 0) - Number(order.settled_amount || 0), 0),
    0
  )
  const creditLimit = settings[0]?.value == null ? null : Number(settings[0].value)

  return {
    today: formatDateOnly(today),
    customer: { name: profiles[0]?.name || null, company: profiles[0]?.company || null },
    totals: {
      orders: orders.length,
      ordersShown: orderContext.length,
      openQuotationRequests: requests.filter((request) => String(request.status).toLowerCase() !== 'rejected').length,
    },
    orders: orderContext,
    quotationRequests: requests.slice(0, MAX_ORDERS).map((request) => ({
      reference: request.quotation_reference,
      status: label(request.status),
      requestedOn: formatTimestamp(request.created_at),
      preferredShipDate: formatDateOnly(request.preferred_ship_date),
      items: (request.quotation_request_items || []).slice(0, MAX_ITEMS).map((item) => ({
        product: productName(item.products),
        quantity: quantityText(item.quantity, item.products?.unit),
      })),
    })),
    quotations: quotations.map((quotation) => ({
      quotationNumber: quotation.quotation_number,
      forRequest: requests.find((request) => request.id === quotation.quotation_request_id)?.quotation_reference || null,
      status: label(quotation.status),
      total: peso(quotation.total_amount),
      downPayment: peso(quotation.down_payment_amount),
      shipping: peso(quotation.shipping_cost),
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
