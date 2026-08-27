import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { faCartFlatbed, faCreditCard, faCartShopping, faWarehouse, faHouse, faClipboardList, faTruck, faBoxesStacked, faFileLines, faShop, faChartLine, faDolly, faTags, faUserTag, faBagShopping, faWallet, faFileSignature } from '@fortawesome/free-solid-svg-icons'

import CustomerOrderCard from '../components/CustomerOrderCard'
import PurchaseOrderCard from '../components/PurchaseOrderCard'
import ComplianceLabelCard from '../components/ComplianceLabelCard'
import QuickActions from '../components/QuickActions'
import bg3 from '../assets/bg_3.jpg'


export default function DashboardPage() {

  const { toast } = useToast()
  const { profile } = useAuth()

  const role = profile?.role
  const isCustomer = role === 'customer'
  const isSales = role === 'sales'
  const isWarehouse = role === 'warehouse'

  const [customerOrderLoading, setCustomerOrderLoading] = useState(true)
  const [purchaseOrderLoading, setPurchaseOrderLoading] = useState(true)
  const [complianceLabelLoading, setComplianceLabelLoading] = useState(true)


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
    if (!profile?.id || role !== 'customer' || role !== 'sales') {
      setCustomerOrderLoading(false)
      return
    }

    setCustomerOrderLoading(true)

    try {
      let query = supabase
        .from('customer_orders')
        .select('status')

      if (role === 'customer') {
        if (!profile?.id) {
          setCustomerOrderLoading(false)
          return
        }

        query = query.eq('customer_id', profile.id)
      }

      const { data, error } = await query

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
      const completed = countStatus('completed')


      // =================================================
      // TOTAL ACTIVE
      // =================================================
      const totalActive = orders.filter((order) => order.status !== 'completed' && order.status !== 'cancelled').length
      const totalOverall = totalActive + completed


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
        completed,
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
    if (role !== 'warehouse') {
      setPurchaseOrderLoading(false)
      return
    }

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
    if (role !== 'warehouse') {
      setComplianceLabelLoading(false)
      return
    }

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
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {

    if (role === 'customer') {
      loadCustomerOrderSummary()
    } else {
      setCustomerOrderLoading(false)
    }

    if (role === 'warehouse') {
      loadPurchaseOrderSummary()
      loadComplianceLabelSummary()
    } else {
      setPurchaseOrderLoading(false)
      setComplianceLabelLoading(false)
    }

    if (role === 'sales') {
      loadCustomerOrderSummary()
      loadComplianceLabelSummary()
    } else {
      setCustomerOrderLoading(false)
      setComplianceLabelLoading(false)
    }

    if (role === 'procurement') {
      loadPurchaseOrderSummary()
    } else {
      setPurchaseOrderLoading(false)
    }

  }, [role, profile?.id ])


  // =====================================================
  // SECTIONS
  // =====================================================
  const sections = [
    {
      title: 'MAIN',
      items: [
        {
          label: 'Dashboard',
          path: 'dashboard',
          icon: faHouse,
          description: 'View your dashboard and operational overview.',
          roles: ['warehouse', 'procurement', 'sales', 'customer'],
        },
      ],
    },
    {
      title: 'ORDER MANAGEMENT',
      items: [
        {
          label: 'PFI Builder',
          path: 'pfi-builder',
          icon: faFileSignature,
          description: 'Create and manage proforma invoice documents.',
          roles: ['admin', 'sales'],
        },
        {
          label: 'Customer Orders',
          path: 'customer-orders',
          icon: faCartShopping,
          description: 'Review and manage customer orders.',
          roles: ['admin', 'sales'],
        },
        {
          label: 'Billings',
          path: 'billings',
          icon: faCreditCard,
          description: 'Review and manage customer payments.',
          roles: ['admin', 'sales'],
        },
      ],
    },
    {
      title: 'PROCUREMENT',
      items: [
        {
          label: 'Purchase Orders',
          path: 'purchase-orders',
          icon: faTruck,
          description: 'Create and manage supplier purchase orders.',
          roles: ['admin', 'procurement', 'warehouse'],
        },
        {
          label: 'Suppliers',
          path: 'suppliers',
          icon: faShop,
          description: 'Manage supplier information and records.',
          roles: ['admin', 'procurement'],
        },
        {
          label: 'Supplier Performance',
          path: 'supplier-performance',
          icon: faChartLine,
          description: 'Monitor supplier performance and activity.',
          roles: ['admin', 'procurement'],
        },
      ],
    },
    {
      title: 'WAREHOUSE',
      items: [
        {
          label: 'Receiving',
          path: 'receiving',
          icon: faDolly,
          description: 'Receive and process incoming goods.',
          roles: ['admin', 'warehouse'],
        },
        {
          label: 'Compliance Labels',
          path: 'compliance-labels',
          icon: faTags,
          description: 'Manage product compliance labels.',
          roles: ['admin', 'warehouse'],
        },
        {
          label: 'Staging',
          path: 'staging',
          icon: faBoxesStacked,
          description: 'Manage products prepared for shipment.',
          roles: ['admin', 'warehouse'],
        },
        {
          label: 'Warehouse Holdings',
          path: 'warehouse-holdings',
          icon: faCartFlatbed,
          description: 'Review warehouse storage holdings.',
          roles: ['admin', 'warehouse'],
        },
        {
          label: 'Warehouse Locations',
          path: 'warehouse-locations',
          icon: faWarehouse,
          description: 'Manage warehouse storage locations.',
          roles: ['admin', 'warehouse'],
        },
      ],
    },
    {
      title: 'MASTER DATA',
      items: [
        {
          label: 'Products',
          path: 'product-catalog',
          icon: faBagShopping,
          description: 'Browse and manage the product catalog.',
          roles: ['admin', 'sales'],
        },
        {
          label: 'Customers',
          path: 'customers',
          icon: faUserTag,
          description: 'Manage customer information and records.',
          roles: ['admin', 'sales',],
        },
      ],
    },
    {
      title: 'ORDERING',
      items: [
        {
          label: 'Delivery Locations',
          path: 'delivery-locations',
          icon: faTruck,
          description: 'Manage your available delivery locations.',
          roles: ['customer'],
        },
        {
          label: 'Product Catalog',
          path: 'product-catalog',
          icon: faBagShopping,
          description: 'Browse available products for ordering.',
          roles: ['customer'],
        },
        {
          label: 'Quotation Requests',
          path: 'quotation-requests',
          icon: faFileLines,
          description: 'Request and track product quotations.',
          roles: ['customer'],
        },
        {
          label: 'My Orders',
          path: 'my-orders',
          icon: faCartShopping,
          description: 'View and track your orders.',
          roles: ['customer'],
        },
      ],
    },
    {
      title: 'PAYMENTS',
      items: [
        {
          label: 'Payments',
          path: 'payments',
          icon: faWallet,
          description: 'Review your payments and payment status.',
          roles: ['customer'],
        },
        {
          label: 'Documents',
          path: 'documents',
          icon: faClipboardList,
          description: 'Access your order and transaction documents.',
          roles: ['customer'],
        },

      ],
    },
    {
      title: 'COMPLIANCE',
      items: [
        {
          label: 'Compliance Labels',
          path: 'compliance-labels',
          icon: faTags,
          description: 'View and manage your compliance labels.',
          roles: ['customer'],
        },
      ],
    },
  ]


  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (
    <div className="min-h-full">

      {/* =================================================
          WELCOME CARD
      ================================================= */}
      <div className="relative mb-6 min-h-[300px] overflow-hidden rounded-2xl shadow-lg">

        <div className="absolute inset-0 bg-cover bg-center transition-all duration-1000" style={{ backgroundImage: `url(${bg3})`}}/>
        <div className="  absolute inset-0 bg-[#1F3A2C]/70"/>

        <div className="relative z-10 flex min-h-[300px] flex-col justify-center px-8 py-10 lg:px-12">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
            DMC Export Consolidation System
          </p>

          <h2 className="max-w-2xl text-4xl font-bold text-white lg:text-5xl">
            Welcome to DMC ECS
          </h2>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80">
            Manage and monitor your export consolidation operations from one centralized system with streamlined workflows and better visibility.
          </p>


          {/* ROLE BADGE */}
          {role && (
            <div className="mt-6">
              <span className="inline-flex rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold uppercase text-white backdrop-blur-sm">
                {role} Access
              </span>
            </div>
          )}
        </div>
      </div>



      {/* =================================================
          CUSTOMER / SALES DASHBOARD
      ================================================= */}
      {(isCustomer || isSales) && (
        <div className="mb-6">
          <CustomerOrderCard title={isCustomer ? "My Orders" : "Customer Orders"} subtitle="Customer Order Progress" summary={customerOrderSummary} loading={customerOrderLoading}/>
        </div>
      )}



      {/* =================================================
          WAREHOUSE DASHBOARD
      ================================================= */}
      {isWarehouse && (
        <div className="mb-6 space-y-6">
          <PurchaseOrderCard title="Purchase Orders" subtitle="Purchase Order Progress" summary={purchaseOrderSummary} loading={purchaseOrderLoading}/>
          <ComplianceLabelCard title="Compliance Label Exchange" subtitle="Compliance Label Progress" summary={complianceLabelSummary} loading={complianceLabelLoading}/>
        </div>
      )}



      {/* =================================================
          QUICK ACTIONS
      ================================================= */}
      <QuickActions sections={sections} role={role}/>


    </div>
  )
}