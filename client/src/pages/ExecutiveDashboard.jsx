'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartLine, faTruck } from '@fortawesome/free-solid-svg-icons'

import CustomerOrderCard from '../components/CustomerOrderCard'
import PurchaseOrderCard from '../components/PurchaseOrderCard'
import ComplianceLabelCard from '../components/ComplianceLabelCard'


export default function ExecutiveDashboard() {

  const { toast } = useToast()

  const [customerOrderLoading, setCustomerOrderLoading] = useState(true)
  const [purchaseOrderLoading, setPurchaseOrderLoading] = useState(true)
  const [complianceLabelLoading, setComplianceLabelLoading] = useState(true)
  const [activeAnalytics, setActiveAnalytics] = useState('customer')
  const [shipmentPredictionLoading, setShipmentPredictionLoading] = useState(true)
  const [shipmentPredictions, setShipmentPredictions] = useState([])


  // =====================================================
  // CUSTOMER ORDER SUMMARY
  // =====================================================
  const [customerOrderSummary, setCustomerOrderSummary] = useState({
    totalActive: 0,
    totalOverall: 0,
    pendingPayment: 0,
    submitted: 0,
    paymentVerified: 0,
    procurement: 0,
    warehousePreparation: 0,
    readyForShipment: 0,
    shipped: 0,
  })


  // =====================================================
  // PURCHASE ORDER SUMMARY
  // =====================================================
  const [purchaseOrderSummary, setPurchaseOrderSummary] = useState({
    sentToSupplier: 0,
    awaitingDelivery: 0,
    partiallyDelivered: 0,
    fullyDelivered: 0,
  })


  // =====================================================
  // COMPLIANCE SUMMARY
  // =====================================================
  const [complianceLabelSummary, setComplianceLabelSummary] = useState({
    notStarted: 0,
    originalLabelReceived: 0,
    awaitingCustomerTranslatedDesign: 0,
    customerDesignLabelReceived: 0,
    printedAwaitingApplication: 0,
    appliedToUnits: 0,
  })



  // =====================================================
  // LOAD CUSTOMER ORDER SUMMARY
  // =====================================================
  async function loadCustomerOrderSummary() {
    setCustomerOrderLoading(true)

    try {
      const { data, error } = await supabase
        .from('customer_orders')
        .select('status')

      if (error) {
        throw error
      }

      const orders = data || []



      // =================================================
      // STATUS COUNTS
      // =================================================
      const countStatus = (status) => orders.filter((order) => order.status === status).length

      const pendingPayment = countStatus('pending payment')
      const submitted = countStatus('submitted')
      const paymentVerified = countStatus('payment verified')
      const procurement = countStatus('procurement')
      const warehousePreparation = countStatus('warehouse preparation')
      const readyForShipment = countStatus('ready for shipment')
      const shipped = countStatus('shipped')


      // =================================================
      // TOTAL ACTIVE
      // =================================================
      const totalActive = orders.filter((order) => order.status !== 'shipped' && order.status !== 'cancelled').length
      const totalOverall = totalActive + shipped


      // =================================================
      // UPDATE SUMMARY
      // =================================================
      setCustomerOrderSummary({
        totalActive,
        totalOverall,
        pendingPayment,
        submitted,
        paymentVerified,
        procurement,
        warehousePreparation,
        readyForShipment,
        shipped,
      })
    }

    catch (error) {
      console.error('Failed to load customer order summary:', error)
      toast.error(error.message || 'Failed to load order summary.')
    }

    finally {
      setCustomerOrderLoading(false)
    }
  }


  // =====================================================
  // LOAD PURCHASE ORDER SUMMARY
  // =====================================================
  async function loadPurchaseOrderSummary() {
    setPurchaseOrderLoading(true)

    try {

      // =================================================
      // PURCHASE ORDERS
      // =================================================
      const { data: purchaseOrders, error: purchaseOrderError } = await supabase
        .from('purchase_orders')
        .select('status')

      if (purchaseOrderError) {
        throw purchaseOrderError
      }

      const poOrders = purchaseOrders || []


      // =================================================
      // PURCHASE ORDER COUNT HELPER
      // =================================================
      const countPOStatus = (status) => poOrders.filter((order) => order.status === status).length

      const sentToSupplier = countPOStatus('sent to supplier')
      const awaitingDelivery = countPOStatus('awaiting delivery')
      const partiallyDelivered = countPOStatus('partially delivered')
      const fullyDelivered = countPOStatus('fully delivered')


      // =================================================
      // UPDATE WAREHOUSE SUMMARY
      // =================================================
      setPurchaseOrderSummary({
        sentToSupplier,
        awaitingDelivery,
        partiallyDelivered,
        fullyDelivered
      })
    }

    catch (error) {
      console.error('Failed to load purchase order summary:', error)
      toast.error(error.message || 'Failed to load purchase order dashboard.')
    }

    finally {
      setPurchaseOrderLoading(false)
    }
  }


  // =====================================================
  // LOAD COMPLIANCE LABEL SUMMARY
  // =====================================================
  async function loadComplianceLabelSummary() {
    setComplianceLabelLoading(true)

    try {

      // =================================================
      // COMPLIANCE LABEL EXCHANGES
      // =================================================
      const { data: complianceLabels, error: complianceLabelError } = await supabase
        .from('compliance_label_exchanges')
        .select('status')

      if (complianceLabelError) {
        throw complianceLabelError
      }

      const labelExchanges = complianceLabels || []


      // =================================================
      // STATUS COUNTS
      // =================================================
      const countLabelStatus = (status) => labelExchanges.filter((exchange) => exchange.status === status).length

      const notStarted = countLabelStatus('not started')
      const originalLabelReceived = countLabelStatus('original label received')
      const awaitingCustomerTranslatedDesign = countLabelStatus('awaiting customer translated design')
      const customerDesignLabelReceived = countLabelStatus('customer design label received')
      const printedAwaitingApplication = countLabelStatus('printed & awaiting application')
      const appliedToUnits = countLabelStatus('applied to units')


      // =================================================
      // UPDATE WAREHOUSE SUMMARY
      // =================================================
      setComplianceLabelSummary({
        notStarted,
        originalLabelReceived,
        awaitingCustomerTranslatedDesign,
        customerDesignLabelReceived,
        printedAwaitingApplication,
        appliedToUnits
      })
    }

    catch (error) {
      console.error('Failed to load compliance label summary:', error)
      toast.error(error.message || 'Failed to load compliance label dashboard.')
    }

    finally {
      setComplianceLabelLoading(false)
    }
  }


  // =====================================================
  // SHIPMENT PREDICTION HELPERS
  // =====================================================
  const ORDER_STATUS_FLOW = [
    'pending payment',
    'submitted',
    'payment verified',
    'procurement',
    'warehouse preparation',
    'ready for shipment',
  ]

  const normalizeStatus = (status) => {
    return (status || '').trim().toLowerCase()
  }

  const median = (values) => {
    if (!values.length) return null

    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)

    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2
    }

    return sorted[middle]
  }

  const percentile = (values, percentileValue) => {
    if (!values.length) return null

    const sorted = [...values].sort((a, b) => a - b)

    const index = (sorted.length - 1) * percentileValue
    const lower = Math.floor(index)
    const upper = Math.ceil(index)

    if (lower === upper) {
      return sorted[lower]
    }

    return (
      sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
    )
  }

  const average = (values) => {
    if (!values.length) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }

  const standardDeviation = (values) => {
    if (values.length < 2) { return 0 }

    const avg = average(values)
    const variance = values.reduce((sum, value) => { return sum + Math.pow(value - avg, 2) }, 0) / values.length

    return Math.sqrt(variance)
  }


  // =====================================================
  // LOAD SHIPMENT PREDICTIONS
  // =====================================================
  async function loadShipmentPredictions() {
    setShipmentPredictionLoading(true)

    try {

      // -------------------------------------------------
      // LOAD ACTIVE ORDERS
      // -------------------------------------------------
      const { data: activeOrders, error: activeOrdersError } = await supabase
        .from('customer_orders')
        .select(`
          id,
          order_number,
          quotation_number,
          status,
          estimated_ship_date,
          created_at
        `)
        .not('status', 'in', '(shipped,cancelled)')

      if (activeOrdersError) {
        throw activeOrdersError
      }

      // -------------------------------------------------
      // LOAD STATUS HISTORY
      // -------------------------------------------------
      const { data: history, error: historyError } = await supabase
        .from('customer_order_status_history')
        .select(`
          customer_order_id,
          previous_status,
          new_status,
          changed_at
        `)
        .order('changed_at', {
          ascending: true,
        })

      if (historyError) {
        throw historyError
      }

      const allHistory = history || []
      const orders = activeOrders || []


      // =================================================
      // BUILD HISTORICAL STAGE DURATIONS
      //
      // Example:
      //
      // procurement
      //  → warehouse preparation
      //
      // gives us the amount of time spent in
      // "procurement".
      // =================================================
      const stageDurations = {}

      ORDER_STATUS_FLOW.forEach((status) => {
        stageDurations[status] = []
      })

      // Group history by customer order
      const historyByOrder = {}

      allHistory.forEach((entry) => {
        if (!historyByOrder[entry.customer_order_id]) {
          historyByOrder[entry.customer_order_id] = []
        }

        historyByOrder[entry.customer_order_id].push(entry)
      })

      // Calculate how long each order stayed in each status
      Object.values(historyByOrder).forEach((entries) => {
        const sortedEntries = [...entries].sort((a, b) =>  new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())

        for (let i = 0; i < sortedEntries.length - 1; i++) {
          const current = sortedEntries[i]
          const next = sortedEntries[i + 1]

          const status = normalizeStatus(current.new_status)

          if (!ORDER_STATUS_FLOW.includes(status)) {
            continue
          }

          const startTime = new Date(current.changed_at).getTime()
          const endTime = new Date(next.changed_at).getTime()

          const durationDays = (endTime - startTime) / (1000 * 60 * 60 * 24)

          // Ignore invalid durations
          if (durationDays < 0) {
            continue
          }

          // Ignore extremely abnormal records
          // greater than 180 days
          if (durationDays > 180) {
            continue
          }

          stageDurations[status].push(durationDays)
        }
      })

      // -------------------------------------------------
      // BUILD STATISTICS FOR EACH STAGE
      // -------------------------------------------------
      const stageStatistics = {}

      ORDER_STATUS_FLOW.forEach((status) => {
        const durations = stageDurations[status] || []

        const medianDuration = median(durations)
        const p25 = percentile(durations, 0.25)
        const p75 = percentile(durations, 0.75)
        const avg = average(durations)
        const deviation = standardDeviation(durations)

        let confidence = 40

        if (durations.length > 0) {

          // More historical examples = more confidence
          const sampleFactor = Math.min(durations.length / 20, 1)

          // Less variation = more confidence
          let consistencyFactor = 1

          if (avg && avg > 0) {
            const coefficientOfVariation = deviation / avg
            consistencyFactor = 1 / (1 + coefficientOfVariation)
          }

          confidence = Math.round(45 + 50 * sampleFactor * consistencyFactor)
          confidence = Math.max(40, Math.min(confidence, 95))
        }

        stageStatistics[status] = {
          median: medianDuration,
          p25,
          p75,
          average: avg,
          standardDeviation: deviation,
          sampleCount: durations.length,
          confidence,
        }
      })

      // -------------------------------------------------
      // PREDICT EACH ACTIVE ORDER
      // -------------------------------------------------
      const predictions = orders.map((order) => {
        const currentStatus = normalizeStatus(order.status)

        // -----------------------------------------------
        // READY FOR SHIPMENT
        // -----------------------------------------------
        if (currentStatus === 'ready for shipment') {
          return {
            ...order,
            currentStatus,
            estimatedReadyDate: new Date(),
            confidence: 100,
            risk: 'on track',
            riskReason: 'Order is already ready for shipment.',
            currentStageAge: 0,
            expectedRemainingDays: 0,
          }
        }

        // -----------------------------------------------
        // UNKNOWN STATUS
        // -----------------------------------------------
        const currentStatusIndex = ORDER_STATUS_FLOW.indexOf(currentStatus)

        if (currentStatusIndex === -1) {
          return {
            ...order,
            currentStatus,
            estimatedReadyDate: null,
            confidence: 0,
            risk: 'at risk',
            riskReason: 'Current order status is not part of the prediction workflow.',
            currentStageAge: 0,
            expectedRemainingDays: null,
          }
        }

        // -----------------------------------------------
        // FIND CURRENT STATUS START TIME
        // -----------------------------------------------
        const orderHistory = historyByOrder[order.id] || []

        const sortedOrderHistory = [...orderHistory].sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime())

        let currentStatusStartedAt = null

        // Find the most recent transition into
        // the current status.
        for (let i = sortedOrderHistory.length - 1; i >= 0; i--) {
          if (normalizeStatus(sortedOrderHistory[i].new_status) === currentStatus) {
            currentStatusStartedAt = new Date( sortedOrderHistory[i].changed_at)
            break
          }
        }

        // If history does not contain the current
        // status, fall back to order creation date.
        if (!currentStatusStartedAt) {
          currentStatusStartedAt = order.created_at ? new Date(order.created_at) : new Date()
        }

        // -----------------------------------------------
        // CURRENT STAGE AGE
        // -----------------------------------------------
        const now = new Date()
        const currentStageAge = Math.max(0, (now.getTime() - currentStatusStartedAt.getTime()) / (1000 * 60 * 60 * 24))

        // -----------------------------------------------
        // CALCULATE REMAINING TIME
        // -----------------------------------------------
        let remainingDays = 0
        let stageConfidenceValues = []

        for (let i = currentStatusIndex; i < ORDER_STATUS_FLOW.length; i++) {
          const stage = ORDER_STATUS_FLOW[i]
          const statistics = stageStatistics[stage]

          if (statistics && statistics.median !== null) {
            remainingDays += statistics.median

            stageConfidenceValues.push(
              statistics.confidence
            )
          }
        }

        // We already spent some time in the current
        // status, so remove the median amount already
        // expected to have elapsed.
        const currentStageStatistics = stageStatistics[currentStatus]

        if (currentStageStatistics && currentStageStatistics.median !== null) {
          remainingDays -= Math.min(currentStageAge, currentStageStatistics.median)
        }

        remainingDays = Math.max(0, remainingDays)

        // -----------------------------------------------
        // ESTIMATED READY DATE
        // -----------------------------------------------
        const estimatedReadyDate = new Date(now.getTime() + remainingDays * 24 * 60 * 60 * 1000)

        // -----------------------------------------------
        // CONFIDENCE
        // -----------------------------------------------
        let confidence = 40

        if (stageConfidenceValues.length > 0) {
          confidence = Math.round( stageConfidenceValues.reduce((sum, value) => sum + value, 0) / stageConfidenceValues.length)
        }

        // -----------------------------------------------
        // RISK DETECTION
        // -----------------------------------------------
        let risk = 'on track'
        let riskReason = 'Order is progressing within historical expectations.'

        // RULE 1:
        // Expected ship date has already been
        // exceeded by the predicted ready date.
        if (order.estimated_ship_date) {
          const expectedShipDate = new Date(`${order.estimated_ship_date}T23:59:59`)

          if (estimatedReadyDate > expectedShipDate) {
            risk = 'at risk'
            riskReason = 'Predicted ready date is later than the estimated ship date.'
          }
        }

        // RULE 2:
        // Current stage is already taking longer
        // than the historical 75th percentile.
        if (currentStageStatistics && currentStageStatistics.p75 !== null && currentStageAge > currentStageStatistics.p75) {
          risk = 'at risk'
          riskReason = `Order has remained in ${currentStatus} longer than the historical 75th percentile.`
        }

        // RULE 3:
        // Low confidence
        if (confidence < 60 && risk !== 'at risk') {
          risk = 'at risk'
          riskReason = 'There is limited or highly variable historical data for this workflow stage.'
        }

        return {
          ...order,
          currentStatus,
          estimatedReadyDate,
          confidence,
          risk,
          riskReason,
          currentStageAge,
          expectedRemainingDays: remainingDays,
          stageStatistics: currentStageStatistics,
        }
      })

      // Sort at-risk orders first
      predictions.sort((a, b) => {
        if (a.risk === 'at risk' && b.risk !== 'at risk') {
          return -1
        }

        if (a.risk !== 'at risk' && b.risk === 'at risk') {
          return 1
        }

        return (new Date(a.estimatedReadyDate || 0) - new Date(b.estimatedReadyDate || 0))
      })

      setShipmentPredictions(predictions)
    }
    
    catch (error) {
      console.error('Failed to load shipment predictions:', error)
      toast.error(error.message || 'Failed to load shipment predictions.')
    }
    
    finally {
      setShipmentPredictionLoading(false)
    }
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadCustomerOrderSummary()
    loadPurchaseOrderSummary()
    loadComplianceLabelSummary()
    loadShipmentPredictions()
  }, [])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* =============================================
          HEADER
      ============================================= */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Executive Dashboard
        </h1>

        <p className="mt-1 text-gray-500">
          Overview of order activity and operational performance.
        </p>
      </div>


      {/* =============================================
          OPERATIONAL ANALYTICS
      ============================================= */}
      <div className="mb-6">

        {/* =============================================
            ANALYTICS TOGGLE
        ============================================= */}
        <div className="mb-4 flex flex-wrap items-center gap-2">

          {/* CUSTOMER ORDERS */}
          <button
            type="button"
            onClick={() => setActiveAnalytics('customer')}
            className={`
              rounded-full border px-4 py-2 text-sm font-medium transition
              ${activeAnalytics === 'customer' ? 'border-[#2D5A42] bg-[#2D5A42] text-white shadow-sm' : 'border-gray-200 bg-white text-gray-500 hover:border-[#B8D5C3] hover:text-[#2D5A42]'}
            `}
          >
            Customer Orders
          </button>


          {/* PURCHASE ORDERS */}
          <button
            type="button"
            onClick={() => setActiveAnalytics('purchase')}
            className={`
              rounded-full border px-4 py-2 text-sm font-medium transition
              ${activeAnalytics === 'purchase' ? 'border-[#2D5A42] bg-[#2D5A42] text-white shadow-sm' : 'border-gray-200 bg-white text-gray-500 hover:border-[#B8D5C3] hover:text-[#2D5A42]'}
            `}
          >
            Purchase Orders
          </button>


          {/* COMPLIANCE LABELS */}
          <button
            type="button"
            onClick={() => setActiveAnalytics('compliance')}
            className={`
              rounded-full border px-4 py-2 text-sm font-medium transition
              ${activeAnalytics === 'compliance' ? 'border-[#2D5A42] bg-[#2D5A42] text-white shadow-sm' : 'border-gray-200 bg-white text-gray-500 hover:border-[#B8D5C3] hover:text-[#2D5A42]'}
            `}
          >
            Compliance Labels
          </button>
        </div>


        {/* =============================================
            SELECTED ANALYTICS CARD
        ============================================= */}
        {activeAnalytics === 'customer' && (
          <CustomerOrderCard
            title="Customer Orders"
            subtitle="Customer Order Progress"
            summary={customerOrderSummary}
            loading={customerOrderLoading}
          />
        )}

        {activeAnalytics === 'purchase' && (
          <PurchaseOrderCard
            title="Purchase Orders"
            subtitle="Purchase Order Progress"
            summary={purchaseOrderSummary}
            loading={purchaseOrderLoading}
          />
        )}

        {activeAnalytics === 'compliance' && (
          <ComplianceLabelCard
            title="Compliance Label Exchange"
            subtitle="Compliance Label Progress"
            summary={complianceLabelSummary}
            loading={complianceLabelLoading}
          />
        )}
      </div>


      {/* =============================================
          FUTURE ANALYTICS
      ============================================= */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PredictiveShipmentCard
          predictions={shipmentPredictions}
          loading={shipmentPredictionLoading}
        />

        <EmptyFeatureCard
          title="Supplier Reliability Reporting"
          icon={faChartLine}
        />
      </div>

    </div>
  )
}








// =============================================
// PREDICTIVE SHIPMENT READINESS CARD
// =============================================

function PredictiveShipmentCard({
  predictions,
  loading,
}) {
  const formatDate = (date) => {
    if (!date) return '—'

    return new Intl.DateTimeFormat(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }
    ).format(new Date(date))
  }

  const formatStatus = (status) => {
    if (!status) return '—'

    return status
      .split(' ')
      .map(
        (word) =>
          word.charAt(0).toUpperCase() +
          word.slice(1)
      )
      .join(' ')
  }

  const onTrackCount =
    predictions.filter(
      (prediction) =>
        prediction.risk === 'on track'
    ).length

  const atRiskCount =
    predictions.filter(
      (prediction) =>
        prediction.risk === 'at risk'
    ).length

  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">

      {/* =============================================
          HEADER
      ============================================= */}

      <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">

        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
          <FontAwesomeIcon
            icon={faTruck}
            className="h-4 w-4"
          />
        </div>

        <div>
          <h2 className="font-semibold text-gray-800">
            Predictive Shipment Readiness
          </h2>

          <p className="text-xs text-gray-400">
            Based on historical order performance
          </p>
        </div>

      </div>

      {/* =============================================
          LOADING
      ============================================= */}

      {loading && (
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <p className="text-sm text-gray-400">
            Analyzing historical order data...
          </p>
        </div>
      )}

      {/* =============================================
          EMPTY
      ============================================= */}

      {!loading &&
        predictions.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <p className="text-sm text-gray-400">
              No active orders available for prediction.
            </p>
          </div>
        )}

      {/* =============================================
          CONTENT
      ============================================= */}

      {!loading &&
        predictions.length > 0 && (
          <div className="flex flex-1 flex-col">

            {/* SUMMARY */}

            <div className="grid grid-cols-3 border-b border-gray-100">

              <div className="px-5 py-4">
                <p className="text-xs text-gray-400">
                  Active Orders
                </p>

                <p className="mt-1 text-2xl font-bold text-gray-800">
                  {predictions.length}
                </p>
              </div>

              <div className="border-l border-gray-100 px-5 py-4">
                <p className="text-xs text-gray-400">
                  On Track
                </p>

                <p className="mt-1 text-2xl font-bold text-[#2D5A42]">
                  {onTrackCount}
                </p>
              </div>

              <div className="border-l border-gray-100 px-5 py-4">
                <p className="text-xs text-gray-400">
                  At Risk
                </p>

                <p className="mt-1 text-2xl font-bold text-red-500">
                  {atRiskCount}
                </p>
              </div>

            </div>

            {/* ORDER LIST */}

            <div className="divide-y divide-gray-100">

              {predictions
                .slice(0, 6)
                .map((prediction) => (

                  <div
                    key={prediction.id}
                    className="px-5 py-4"
                  >

                    <div className="flex items-start justify-between gap-4">

                      {/* ORDER */}

                      <div className="min-w-0">

                        <p className="truncate text-sm font-semibold text-gray-800">
                          {prediction.order_number ||
                            prediction.quotation_number ||
                            'Customer Order'}
                        </p>

                        <p className="mt-0.5 text-xs text-gray-400">
                          {formatStatus(
                            prediction.currentStatus
                          )}
                        </p>

                      </div>

                      {/* RISK */}

                      <div
                        className={`
                          shrink-0 rounded-full px-2.5 py-1
                          text-[11px] font-semibold
                          ${
                            prediction.risk ===
                            'at risk'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-green-50 text-[#2D5A42]'
                          }
                        `}
                      >
                        {prediction.risk ===
                        'at risk'
                          ? 'At Risk'
                          : 'On Track'}
                      </div>

                    </div>

                    {/* PREDICTION DETAILS */}

                    <div className="mt-3 grid grid-cols-2 gap-3">

                      <div>
                        <p className="text-[11px] text-gray-400">
                          Estimated Ready
                        </p>

                        <p className="mt-0.5 text-sm font-medium text-gray-700">
                          {formatDate(
                            prediction.estimatedReadyDate
                          )}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] text-gray-400">
                          Confidence
                        </p>

                        <div className="mt-1 flex items-center gap-2">

                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">

                            <div
                              className="h-full rounded-full bg-[#2D5A42]"
                              style={{
                                width: `${Math.min(
                                  prediction.confidence,
                                  100
                                )}%`,
                              }}
                            />

                          </div>

                          <span className="text-xs font-medium text-gray-600">
                            {prediction.confidence}%
                          </span>

                        </div>
                      </div>

                    </div>

                    {/* RISK REASON */}

                    {prediction.risk ===
                      'at risk' && (
                      <p className="mt-3 text-xs leading-5 text-red-500">
                        {prediction.riskReason}
                      </p>
                    )}

                  </div>

                ))}

            </div>

            {/* MORE ORDERS */}

            {predictions.length > 6 && (
              <div className="border-t border-gray-100 px-5 py-3">

                <p className="text-center text-xs text-gray-400">
                  Showing 6 of {predictions.length}{' '}
                  active orders
                </p>

              </div>
            )}

          </div>
        )}

    </div>
  )
}












// =============================================
// EMPTY FEATURE CARD
// =============================================
function EmptyFeatureCard({ title, icon }) {
  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">


      {/* =============================================
          HEADER
      ============================================= */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-white bg-[#2D5A42]`}
        >
          <FontAwesomeIcon icon={icon} className="h-4 w-4"/>
        </div>

        <div>
          <h2 className="font-semibold text-gray-800">
            {title}
          </h2>

          <p className="text-xs text-gray-400">
            Analytics
          </p>
        </div>
      </div>


      {/* =============================================
          EMPTY STATE
      ============================================= */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-gray-500">
          Feature Shipping Soon
        </p>
      </div>
    </div>
  )
}