import { PORTAL_FAQ } from './rules.js'
import { describePayment } from './describe.js'


// =============================================================================
// Rule-based answers, from the same customer data the AI gets
//
// Used when the AI can't answer (no API key, provider limit reached, no
// internet), so the assistant still gives correct answers for the common
// questions. Words are matched whole ("which" is not "hi"), and the order of
// INTENTS matters: "How do I pay?" is a how-to question, and "When do I need
// to pay?" is a payment question, not a timing one.
// =============================================================================

const has = (text, pattern) => pattern.test(text)

const INTENTS = [
  ['greeting', /^\s*(hi|hello|hey|good (morning|afternoon|evening))( there)?[\s!.,?]*$/],
  ['help', /^\s*(help( me)?|\?)[\s!.?]*$|\bwhat can you (do|answer|help( me)? with)\b|\bwhat can i ask\b|\bhow can you help\b/],
  ['howto', /\bhow (do|can|should|does) (i|we|it)\b|\bhow to\b/],
  ['credit', /\b(credit|limit|blocked|on hold)\b|\b(can't|cannot|unable to)\b.{0,20}\b(order|request|approve)\b/],
  ['documents', /\b(documents?|packing list|certificates?|paperwork|download)\b/],
  ['quotation', /\b(quotations?|quotes?|pfi|expir(e|es|ed|y|ing)|valid(ity)?)\b/],
  ['payment', /\b(pay|paid|paying|payments?|balance|owe|owed|due|deadline|down ?payment|overdue|verif\w*|reject\w*)\b/],
  ['readiness', /\b(when|ready|arrive|arrival|eta|estimate\w*|how long|ship date)\b/],
  ['labels', /\b(labels?|labell?ing|stickers?|translated design)\b/],
  ['product', /\b(moq|minimum|available|unavailable|availability|in stock|stock)\b/],
  ['status', /\b(status|progress|where|track(ing)?|update|step|shipped)\b/],
]

// A product name beats the plain word "order" ("Can I order Lucky Me?").
function detectIntent(text, context) {
  const match = INTENTS.find(([, pattern]) => has(text, pattern))
  if (match) return match[0]
  if (context.productsMentioned.length > 0) return 'product'
  return 'status'
}


// Orders the customer named, otherwise all of them (newest first).
function focusOrders(message, orders) {
  const upper = message.toUpperCase()
  const named = orders.filter((order) => order.orderNumber && upper.includes(order.orderNumber.toUpperCase()))
  return { orders: named.length ? named : orders, named: named.length > 0 }
}

const list = (lines) => lines.map((line) => `- ${line}`).join('\n')

const MAX_SHOWN = 5

function orderLines(orders, toLine) {
  const shown = orders.slice(0, MAX_SHOWN)
  const more = orders.length > shown.length ? `\n\nShowing your ${shown.length} most recent of ${orders.length}.` : ''
  return `${list(shown.map(toLine))}${more}`
}


// =============================================
// ONE LINE PER ORDER
// =============================================
// What each status means to the customer.
const STATUS_TEXT = {
  'Pending payment': 'waiting for your down payment',
  Submitted: 'your payment is awaiting DMC\'s verification',
  'Payment rejected': 'your payment was rejected, so please pay again',
  'Payment verified': 'down payment verified',
  Procurement: 'DMC is sourcing your products',
  'Warehouse preparation': 'being prepared in DMC\'s warehouse',
  'Ready for shipment': 'ready for shipment',
}

function statusLine(order) {
  if (order.shippedOn) return `${order.orderNumber}: shipped on ${order.shippedOn}.`
  const p = order.progress
  const next = p.nextStep ? ` Next: ${p.nextStep}.` : ''
  return `${order.orderNumber}: ${p.step ? `${p.step}, ` : ''}${STATUS_TEXT[p.status] || p.status}.${next}`
}

function readinessLine(order) {
  if (order.shippedOn) return `${order.orderNumber}: already shipped on ${order.shippedOn}.`
  if (order.progress.status === 'Ready for shipment') return `${order.orderNumber}: already ready for shipment.`
  if (order.estimatedReady) {
    return `${order.orderNumber}: estimated ready for shipment by ${order.estimatedReady.readyForShipmentBy}.`
  }
  return `${order.orderNumber}: an estimated ready date isn't available yet.`
}

const paymentLine = (order) => `${order.orderNumber}: ${describePayment(order.payment)}.`

function labelsLine(order) {
  const l = order.labels
  if (l.items.every((item) => item.status === 'Not started yet')) return `${order.orderNumber}: labeling hasn't started yet.`
  if (l.waitingForYourDesign.length) {
    return `${order.orderNumber}: waiting for your translated design for ${l.waitingForYourDesign.join(', ')}.`
  }
  const applied = l.items.filter((item) => item.status === 'Applied to units').length
  return applied === l.items.length
    ? `${order.orderNumber}: all labels applied.`
    : `${order.orderNumber}: ${applied} of ${l.items.length} labels applied; nothing needed from you right now.`
}

function documentsLine(order) {
  const d = order.documents
  const available = [
    d.quotationPfi && 'quotation (PFI)',
    d.packingList && 'packing list',
    d.certificateOfShipment && 'certificate of shipment',
    d.certificateOfClearance && 'certificate of clearance',
  ].filter(Boolean)
  return `${order.orderNumber}: ${available.length ? available.join(', ') : 'no documents yet'}.`
}

function creditLine(credit) {
  return credit.canPlaceNewOrders
    ? `Your unpaid balance is ${credit.unpaidBalance}, within your credit limit of ${credit.creditLimit}, so you can place new orders.`
    : `Your unpaid balance of ${credit.unpaidBalance} has reached your credit limit of ${credit.creditLimit}, so new quotation requests and approvals are on hold until you pay. Only payments verified by DMC reduce the balance.`
}

const faq = (topic) => PORTAL_FAQ.find((entry) => entry.topic === topic)?.answer


// =============================================
// HOW-TO QUESTIONS
// =============================================
// The approved answer, plus the customer's own details where they help.
const HOWTO_TOPICS = [
  [/\breject/, 'Rejected payments', 'payment'],
  [/\b(deadline|due|overdue|late)\b/, 'Payment deadline', 'payment'],
  [/\b(pay|paid|payments?|balance|owe|proof|bank)\b/, 'Payments', 'payment'],
  [/\b(credit|limit)\b/, 'Credit limit', 'credit'],
  [/\b(labels?|stickers?|design)\b/, 'Compliance labels', 'labels'],
  [/\b(documents?|certificates?|packing|download|pfi)\b/, 'Documents', null],
  [/\b(address|location)/, 'Delivery locations', null],
  [/\b(track|progress|status|ready)\b/, 'Order progress', 'status'],
  [/\b(moq|minimum)\b/, 'Minimum order quantity', null],
  [/\bavailab|\bunavailab/, 'Unavailable products', null],
  [/\b(approve|expir|valid)/, 'Quotation validity', null],
]

const DETAIL_LINES = { payment: paymentLine, labels: labelsLine, status: statusLine }

function howToReply(text, context, orders) {
  const [, topic, details] = HOWTO_TOPICS.find(([pattern]) => has(text, pattern)) || [null, 'Placing an order', null]
  const answer = faq(topic)

  if (details === 'credit') return `${answer}\n\n${creditLine(context.credit)}`
  if (details && orders.length) return `${answer}\n\nYour orders:\n${orderLines(orders, DETAIL_LINES[details])}`
  return answer
}


// =============================================
// THE ANSWER
// =============================================
export function getFallbackReply(message, context) {
  const text = message.toLowerCase().replace(/[‘’]/g, '\'')
  const intent = detectIntent(text, context)
  const { orders, named } = focusOrders(message, context.orders)
  const firstName = context.customer.name?.trim().split(' ')[0]

  if (intent === 'greeting') {
    const count = context.totals.orders
    return `Hello${firstName ? ` ${firstName}` : ''}! You have ${count} ${count === 1 ? 'order' : 'orders'} with DMC. Ask me where an order is, when it should be ready, what you still owe, or about your quotations.`
  }

  if (intent === 'help') {
    return `You can ask me things like:\n${list([
      'Where are my orders now?',
      'When will my order be ready for shipment?',
      'What do I still owe?',
      'When does my quotation expire?',
      'What is the minimum order for a product?',
      'How do I pay?',
    ])}\n\nI can look things up for you, but I can't change anything.`
  }

  if (intent === 'howto') return howToReply(text, context, orders)

  if (intent === 'credit') return creditLine(context.credit)

  if (intent === 'quotation') {
    const open = context.quotations.filter((q) => q.status === 'Pending approval')
    const waiting = context.quotationRequests.filter((r) => r.status === 'Awaiting pricing')
    const lines = [
      ...open.map((q) => `${q.quotationNumber} (for ${q.forRequest}): ${q.total}, ${q.expired ? `expired on ${q.expiresOn}, so please ask for a new quotation` : `valid until ${q.expiresOn}`}.`),
      ...waiting.map((r) => `${r.reference}: waiting for DMC to price it.`),
    ]
    return lines.length
      ? `Your open quotations and requests:\n${list(lines)}\n\nYou can approve or reject a quotation in Quotation Requests.`
      : `You don't have any quotations waiting for your approval. ${faq('Quotation validity')}`
  }

  if (intent === 'product') {
    if (!context.productsMentioned.length) {
      return `I couldn't find that product. ${faq('Minimum order quantity')}`
    }
    return `Here's what I found:\n${list(context.productsMentioned.map(
      (p) => `${p.product}: minimum order ${p.minimumOrder}, ${p.available ? 'available' : 'currently unavailable for new requests'}.`
    ))}`
  }

  // Questions about the customer's orders from here on.
  if (!context.orders.length) {
    const waiting = context.quotationRequests.filter((r) => r.status === 'Awaiting pricing').length
    return `You don't have any orders yet.${waiting
      ? ` ${waiting} of your quotation ${waiting === 1 ? 'request is' : 'requests are'} waiting for DMC to price ${waiting === 1 ? 'it' : 'them'}.`
      : ' You can start by creating a quotation request.'}`
  }

  if (intent === 'payment') {
    const unpaid = named ? orders : orders.filter((order) => !order.payment.fullyPaid)
    if (!unpaid.length) return 'All your orders are fully paid.'
    return orderLines(unpaid, paymentLine)
  }

  if (intent === 'readiness') {
    const active = named ? orders : orders.filter((order) => !order.shippedOn)
    if (!active.length) return 'All your orders have already shipped.'
    return `${orderLines(active, readinessLine)}\n\nThese are estimates based on past orders, not guaranteed dates.`
  }

  if (intent === 'labels') {
    return `${orderLines(orders, labelsLine)}\n\nYou can upload translated designs on the Compliance Labels page.`
  }

  if (intent === 'documents') {
    return `${orderLines(orders, documentsLine)}\n\nYou can download them on the Documents page.`
  }

  return orderLines(orders, statusLine)
}
