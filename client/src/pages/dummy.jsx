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
    completed: 0,
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



  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadCustomerOrderSummary()
    loadPurchaseOrderSummary()
    loadComplianceLabelSummary()
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
        <EmptyFeatureCard
          title="Predictive Shipment Readiness"
          icon={faTruck}
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