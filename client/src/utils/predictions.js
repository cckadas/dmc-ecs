// =============================================================================
// Shipment predictions — the maths only
//
// Statistical, from DMC's own history: how long past orders stayed in each
// status (customer_order_status_history), as medians. An active order's
// predicted ready date = now + the median time of each stage still ahead,
// less the time already spent in its current stage.
//
// No imports on purpose: the website (services/predictionService.js) and the
// server's customer assistant (server/chatbot) both use this file, so every
// screen and the chatbot give the same estimate.
// =============================================================================

export const ORDER_STATUS_FLOW = [
  'pending payment',
  'submitted',
  'payment verified',
  'procurement',
  'warehouse preparation',
  'ready for shipment',
]

export const normalizeStatus = (status) => (status || '').trim().toLowerCase()

const DAY = 1000 * 60 * 60 * 24

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const percentile = (values, percentileValue) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentileValue
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

const standardDeviation = (values) => {
  if (values.length < 2) return 0
  const avg = average(values)
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length
  return Math.sqrt(variance)
}

const byTime = (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()


// How long orders historically stayed in each status, plus the history
// grouped by order.
export function buildStageStatistics(allHistory) {
  const stageDurations = {}
  ORDER_STATUS_FLOW.forEach((status) => { stageDurations[status] = [] })

  const historyByOrder = {}
  allHistory.forEach((entry) => {
    if (!historyByOrder[entry.customer_order_id]) historyByOrder[entry.customer_order_id] = []
    historyByOrder[entry.customer_order_id].push(entry)
  })

  // Time spent in a status = from entering it until the next change.
  Object.values(historyByOrder).forEach((entries) => {
    const sorted = [...entries].sort(byTime)

    for (let i = 0; i < sorted.length - 1; i++) {
      const status = normalizeStatus(sorted[i].new_status)
      if (!ORDER_STATUS_FLOW.includes(status)) continue

      const durationDays = (new Date(sorted[i + 1].changed_at).getTime() - new Date(sorted[i].changed_at).getTime()) / DAY

      // Ignore invalid and extremely abnormal records (over 180 days).
      if (durationDays < 0 || durationDays > 180) continue

      stageDurations[status].push(durationDays)
    }
  })

  const stageStatistics = {}

  ORDER_STATUS_FLOW.forEach((status) => {
    const durations = stageDurations[status] || []
    const avg = average(durations)
    const deviation = standardDeviation(durations)

    let confidence = 40

    if (durations.length > 0) {
      // More historical examples and less variation = more confidence.
      const sampleFactor = Math.min(durations.length / 20, 1)
      let consistencyFactor = 1
      if (avg && avg > 0) consistencyFactor = 1 / (1 + deviation / avg)
      confidence = Math.max(40, Math.min(Math.round(45 + 50 * sampleFactor * consistencyFactor), 95))
    }

    stageStatistics[status] = {
      median: median(durations),
      p25: percentile(durations, 0.25),
      p75: percentile(durations, 0.75),
      average: avg,
      standardDeviation: deviation,
      sampleCount: durations.length,
      confidence,
    }
  })

  return { stageStatistics, historyByOrder }
}


// The prediction for one order: estimatedReadyDate, confidence, risk.
export function predictOrder(order, stageStatistics, historyByOrder) {
  const currentStatus = normalizeStatus(order.status)

  if (currentStatus === 'ready for shipment') {
    return {
      ...order, currentStatus, estimatedReadyDate: new Date(), confidence: 100,
      risk: 'on track', riskReason: 'Order is already ready for shipment.',
      currentStageAge: 0, expectedRemainingDays: 0,
    }
  }

  const currentStatusIndex = ORDER_STATUS_FLOW.indexOf(currentStatus)

  if (currentStatusIndex === -1) {
    return {
      ...order, currentStatus, estimatedReadyDate: null, confidence: 0,
      risk: 'at risk', riskReason: 'Current order status is not part of the prediction workflow.',
      currentStageAge: 0, expectedRemainingDays: null,
    }
  }

  // When the order entered its current status (else its creation date).
  const orderHistory = [...(historyByOrder[order.id] || [])].sort(byTime)
  let currentStatusStartedAt = null

  for (let i = orderHistory.length - 1; i >= 0; i--) {
    if (normalizeStatus(orderHistory[i].new_status) === currentStatus) {
      currentStatusStartedAt = new Date(orderHistory[i].changed_at)
      break
    }
  }

  if (!currentStatusStartedAt) {
    currentStatusStartedAt = order.created_at ? new Date(order.created_at) : new Date()
  }

  const now = new Date()
  const currentStageAge = Math.max(0, (now.getTime() - currentStatusStartedAt.getTime()) / DAY)

  // Median time of every stage still ahead, less what's already elapsed.
  let remainingDays = 0
  const stageConfidenceValues = []

  for (let i = currentStatusIndex; i < ORDER_STATUS_FLOW.length; i++) {
    const statistics = stageStatistics[ORDER_STATUS_FLOW[i]]
    if (statistics && statistics.median !== null) {
      remainingDays += statistics.median
      stageConfidenceValues.push(statistics.confidence)
    }
  }

  const currentStageStatistics = stageStatistics[currentStatus]

  if (currentStageStatistics && currentStageStatistics.median !== null) {
    remainingDays -= Math.min(currentStageAge, currentStageStatistics.median)
  }

  remainingDays = Math.max(0, remainingDays)

  const estimatedReadyDate = new Date(now.getTime() + remainingDays * DAY)

  let confidence = 40
  if (stageConfidenceValues.length > 0) {
    confidence = Math.round(stageConfidenceValues.reduce((sum, value) => sum + value, 0) / stageConfidenceValues.length)
  }

  // Risk rules
  let risk = 'on track'
  let riskReason = 'Order is progressing within historical expectations.'

  // 1. The predicted ready date is later than the estimated ship date.
  if (order.estimated_ship_date) {
    const expectedShipDate = new Date(`${order.estimated_ship_date}T23:59:59`)
    if (estimatedReadyDate > expectedShipDate) {
      risk = 'at risk'
      riskReason = 'Predicted ready date is later than the estimated ship date.'
    }
  }

  // 2. The current stage is taking longer than the historical 75th percentile.
  if (currentStageStatistics && currentStageStatistics.p75 !== null && currentStageAge > currentStageStatistics.p75) {
    risk = 'at risk'
    riskReason = `Order has remained in ${currentStatus} longer than the historical 75th percentile.`
  }

  // 3. Low confidence.
  if (confidence < 60 && risk !== 'at risk') {
    risk = 'at risk'
    riskReason = 'There is limited or highly variable historical data for this workflow stage.'
  }

  return {
    ...order, currentStatus, estimatedReadyDate, confidence, risk, riskReason,
    currentStageAge, expectedRemainingDays: remainingDays, stageStatistics: currentStageStatistics,
  }
}
