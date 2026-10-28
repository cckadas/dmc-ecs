'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChartLine, faTruck, faExclamationTriangle, faCircleExclamation } from '@fortawesome/free-solid-svg-icons'

import CustomerOrderCard from '../components/CustomerOrderCard'
import PurchaseOrderCard from '../components/PurchaseOrderCard'
import ComplianceLabelCard from '../components/ComplianceLabelCard'
import { predictOrders } from '../services/predictionService'
import { OrderStepsBar } from '../components/OrderProgress'


export default function ExecutiveDashboard() {

  const { toast } = useToast()

  const [customerOrderLoading, setCustomerOrderLoading] = useState(true)
  const [purchaseOrderLoading, setPurchaseOrderLoading] = useState(true)
  const [complianceLabelLoading, setComplianceLabelLoading] = useState(true)
  const [activeAnalytics, setActiveAnalytics] = useState('customer')
  const [shipmentPredictionLoading, setShipmentPredictionLoading] = useState(true)
  const [shipmentPredictions, setShipmentPredictions] = useState([])
  const [supplierPerformanceLoading, setSupplierPerformanceLoading] = useState(true)
  const [supplierPerformance, setSupplierPerformance] = useState([])


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
  // LOAD SUPPLIER PERFORMANCE
  // =====================================================
  async function loadSupplierPerformance() {
    setSupplierPerformanceLoading(true)

    try {

      // =================================================
      // LOAD ALL SUPPLIERS
      // =================================================
      const { data: suppliers, error: suppliersError } = await supabase
        .from('suppliers')
        .select(`
          id,
          supplier_name
        `)
        .order('supplier_name', {
          ascending: true,
        })

      if (suppliersError) {
        throw suppliersError
      }

      const allSuppliers = suppliers || []


      // =================================================
      // LOAD SUPPLIER PERFORMANCE
      // =================================================
      const { data: performance, error: performanceError } = await supabase
        .from('supplier_performance')
        .select(`
          id,
          supplier_id,
          total_orders,
          on_time_deliveries,
          late_deliveries,
          average_lead_time_days,
          reliability_rating,
          notes,
          created_at,
          updated_at
        `)

      if (performanceError) {
        throw performanceError
      }

      const performanceRecords = performance || []


      // =================================================
      // MATCH EACH SUPPLIER WITH ITS LATEST PERFORMANCE
      // =================================================
      const supplierPerformanceData = allSuppliers.map((supplier) => {
        const supplierRecords = performanceRecords.filter((record) => record.supplier_id === supplier.id)
        const latestPerformance = supplierRecords.length > 0 ? supplierRecords[0] : null

        return { supplier, performance: latestPerformance }
      })

      setSupplierPerformance(supplierPerformanceData)
    }

    catch (error) {
      console.error('Failed to load supplier performance:', error)
      toast.error(error.message || 'Failed to load supplier performance.')
    }

    finally {
      setSupplierPerformanceLoading(false)
    }
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

      // Statistical predictions from past orders' stage durations, shared
      // with the order progress tracker (services/predictionService.js).
      const predictions = await predictOrders(activeOrders || [])

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
    loadSupplierPerformance()
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

        <SupplierPerformanceCard
          performance={supplierPerformance}
          loading={supplierPerformanceLoading}
        />
      </div>

    </div>
  )
}





// =============================================
// PREDICTIVE SHIPMENT READINESS CARD
// =============================================
function PredictiveShipmentCard({ predictions, loading }) {

  const formatDate = (date) => {
    if (!date) return '—'
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
  }

  const formatStatus = (status) => {
    if (!status) return '—'

    return status
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const onTrackCount = predictions.filter((prediction) => prediction.risk === 'on track').length
  const atRiskCount = predictions.filter((prediction) => prediction.risk === 'at risk').length


  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">

      {/* =============================================
          HEADER
      ============================================= */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faTruck} className="h-4 w-4" />
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

        {/* Beta Badge */}
        <span className="flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 font-medium text-[11px] uppercase tracking-wider text-orange-600">
          <FontAwesomeIcon icon={faExclamationTriangle} className="h-2.5 w-2.5"/>
          Beta
        </span>
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
      {!loading && predictions.length === 0 && (
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <p className="text-sm text-gray-400">
            No active orders available for prediction.
          </p>
        </div>
      )}


      {/* =============================================
          CONTENT
      ============================================= */}
      {!loading && predictions.length > 0 && (
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

                  <div key={prediction.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">

                      {/* ORDER */}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-800">
                          {prediction.order_number || prediction.quotation_number || 'Customer Order'}
                        </p>

                        <p className="mt-0.5 text-xs text-gray-400">
                          {formatStatus( prediction.currentStatus )}
                        </p>

                        <OrderStepsBar status={prediction.currentStatus}/>
                      </div>

                      {/* RISK */}
                      <div className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ prediction.risk === 'at risk' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-[#2D5A42]' }`}>
                        {prediction.risk === 'at risk' ? 'At Risk' : 'On Track'}
                      </div>
                    </div>

                    {/* PREDICTION DETAILS */}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] text-gray-400">
                          Estimated Ready
                        </p>

                        <p className="mt-0.5 text-sm font-medium text-gray-700">
                          {formatDate( prediction.estimatedReadyDate )}
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] text-gray-400">
                          Confidence
                        </p>

                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-[#2D5A42]" style={{ width: `${Math.min(prediction.confidence, 100)}%` }}/>
                          </div>

                          <span className="text-xs font-medium text-gray-600">
                            {prediction.confidence}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* RISK REASON */}
                    {prediction.risk === 'at risk' && (
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
                  Showing 6 of {predictions.length}{' '} active orders
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
function SupplierPerformanceCard({ performance, loading }) {

  // =====================================================
  // HELPERS
  // =====================================================
  const formatRating = (rating) => {
    if (rating === null || rating === undefined) { return '—' }
    return Number(rating).toFixed(1)
  }

  const getRatingPercentage = (rating) => {
    if (rating === null || rating === undefined) { return 0 }
    return Math.min(Math.max((Number(rating) / 5) * 100, 0), 100)
  }

  const getRatingLabel = (rating) => {
    if (rating === null || rating === undefined) { return 'No rating' }

    const value = Number(rating)

    if (value >= 4.5) { return 'Excellent' }
    if (value >= 3.5) { return 'Good' }
    if (value >= 2.5) { return 'Fair' }
    return 'Poor'
  }


  // =====================================================
  // SUMMARY
  // =====================================================
  const totalSuppliers = performance.length
  const suppliersWithData = performance.filter((item) => item.performance !== null).length
  const suppliersWithoutData = totalSuppliers - suppliersWithData


  // =====================================================
  // LOADING
  // =====================================================
  if (loading) {
    return (
      <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" />
          </div>

          <div>
            <h2 className="font-semibold text-gray-800">
              Supplier Reliability Reporting
            </h2>

            <p className="text-xs text-gray-400">
              Supplier performance
            </p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <p className="text-sm text-gray-400">
            Loading supplier performance...
          </p>
        </div>
      </div>
    )
  }


  // =====================================================
  // EMPTY
  // =====================================================
  if (performance.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" />
          </div>

          <div>
            <h2 className="font-semibold text-gray-800">
              Supplier Reliability Reporting
            </h2>

            <p className="text-xs text-gray-400">
              Supplier performance
            </p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-gray-400">
            No suppliers available.
          </p>
        </div>
      </div>
    )
  }


  // =====================================================
  // MAIN CARD
  // =====================================================
  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">

      {/* =============================================
          HEADER
      ============================================= */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-3">

          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" />
          </div>

          <div>
            <h2 className="font-semibold text-gray-800">
              Supplier Reliability Reporting
            </h2>

            <p className="text-xs text-gray-400">
              Latest supplier performance
            </p>
          </div>
        </div>
      </div>


      {/* =============================================
          SUMMARY
      ============================================= */}
      <div className="grid grid-cols-3 border-b border-gray-100">
        <div className="px-5 py-4">
          <p className="text-xs text-gray-400">
            Suppliers
          </p>

          <p className="mt-1 text-2xl font-bold text-gray-800">
            {totalSuppliers}
          </p>
        </div>

        <div className="border-l border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-400">
            Rated
          </p>

          <p className="mt-1 text-2xl font-bold text-[#2D5A42]">
            {suppliersWithData}
          </p>
        </div>

        <div className="border-l border-gray-100 px-5 py-4">
          <p className="text-xs text-gray-400">
            Unrated
          </p>

          <p className="mt-1 text-2xl font-bold text-gray-500">
            {suppliersWithoutData}
          </p>
        </div>
      </div>


      {/* =============================================
          SUPPLIER LIST
      ============================================= */}
      <div className="divide-y divide-gray-100">

        {performance.map((item) => {

          const supplier = item.supplier
          const supplierRecord = item.performance

          const rating = supplierRecord?.reliability_rating
          const hasPerformance = supplierRecord !== null && rating !== null && rating !== undefined

          return (
            <div key={supplier.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">

                {/* =================================
                    SUPPLIER NAME
                ================================= */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-800">
                    {supplier.supplier_name || 'Unnamed Supplier'}
                  </p>

                  {hasPerformance ? (

                    <p className="mt-0.5 text-xs text-gray-400">
                      {getRatingLabel(rating)}
                    </p>

                  ) : (

                    <div className="mt-1 flex items-center gap-1.5">
                      <FontAwesomeIcon icon={faCircleExclamation} className="h-3 w-3 text-gray-400"/>

                      <p className="text-xs text-gray-400">
                        No performance data
                      </p>
                    </div>

                  )}
                </div>

                {/* =================================
                    SCORE
                ================================= */}
                {hasPerformance ? (

                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-800">
                        {formatRating(rating)}
                        <span className="ml-0.5 text-xs font-normal text-gray-400">
                          / 5
                        </span>
                      </p>
                    </div>
                  </div>

                ) : (

                  <span className="shrink-0 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-400">
                    Unrated
                  </span>

                )}
              </div>


              {/* =================================
                  SCORE BAR
              ================================= */}
              {hasPerformance && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-[#2D5A42]" style={{ width: `${getRatingPercentage(rating)}%` }}/>
                  </div>

                  <span className="text-[11px] text-gray-400">
                    {getRatingLabel(rating)}
                  </span>
                </div>
              )}


              {/* =================================
                  PERFORMANCE DETAILS
              ================================= */}
              {hasPerformance && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] text-gray-400">
                      Total Orders
                    </p>

                    <p className="mt-0.5 text-xs font-medium text-gray-700">
                      {supplierRecord.total_orders ?? 0}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-gray-400">
                      On Time
                    </p>

                    <p className="mt-0.5 text-xs font-medium text-gray-700">
                      {supplierRecord.on_time_deliveries ?? 0}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-gray-400">
                      Avg. Lead Time
                    </p>

                    <p className="mt-0.5 text-xs font-medium text-gray-700">
                      {supplierRecord.average_lead_time_days !== null && supplierRecord.average_lead_time_days !== undefined ? `${supplierRecord.average_lead_time_days} days` : '—'}
                    </p>
                  </div>
                </div>
              )}

            </div>
          )
        })}
      </div>
    </div>
  )
}