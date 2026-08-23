'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import {
  faBoxes,
  faChartLine,
  faTruck,
  faClock,
  faFileCircleCheck,
  faCreditCard,
  faCartShopping,
  faWarehouse,
  faTruckFast,
  faCircleCheck,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'


export default function ExecutiveDashboard() {

  const { toast } = useToast()

  const [summary, setSummary] = useState({
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

  const [loading, setLoading] = useState(true)


  // =============================================
  // LOAD EXECUTIVE SUMMARY
  // =============================================
  async function loadSummary() {
    setLoading(true)

    const { data, error } = await supabase
      .from('customer_orders')
      .select('status')

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    const orders = data || []


    // ---------------------------------------------
    // STATUS COUNT HELPER
    // ---------------------------------------------
    const countStatus = (status) =>
      orders.filter(
        (order) => order.status === status
      ).length


    // ---------------------------------------------
    // INDIVIDUAL STATUS COUNTS
    // ---------------------------------------------
    const pendingPayment = countStatus('pending_payment')
    const submitted = countStatus('submitted')
    const paymentVerified = countStatus('payment_verified')
    const procurement = countStatus('procurement')
    const warehousePreparation = countStatus('warehouse_preparation')
    const readyForShipment = countStatus('ready_for_shipment')
    const completed = countStatus('completed')


    // ---------------------------------------------
    // TOTAL ACTIVE ORDERS
    // Excludes completed and cancelled orders
    // ---------------------------------------------
    const totalActive = orders.filter(
      (order) => order.status !== 'completed' && order.status !== 'cancelled'
    ).length


    // ---------------------------------------------
    // TOTAL OVERALL ORDERS
    // Active + Completed
    // Cancelled orders are excluded
    // ---------------------------------------------
    const totalOverall = totalActive + completed


    // ---------------------------------------------
    // UPDATE SUMMARY
    // ---------------------------------------------
    setSummary({
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

    setLoading(false)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadSummary()
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

        <p className="text-gray-500">
          Overview of order activity and operational performance.
        </p>
      </div>


      {/* =============================================
          CUSTOMER ORDER ANALYTICS
      ============================================= */}
      <div className="mb-8">
        <CustomerOrderCard
          title="Customer Orders"
          summary={summary}
          loading={loading}
        />
      </div>


      {/* =============================================
          FUTURE ANALYTICS
      ============================================= */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EmptyFeatureCard
          title="Predictive Shipment Readiness"
          icon={faTruck}
          index={0}
        />

        <EmptyFeatureCard
          title="Supplier Reliability Reporting"
          icon={faChartLine}
          index={1}
        />
      </div>

    </div>
  )
}


// =============================================
// CUSTOMER ORDER CARD
// =============================================
function CustomerOrderCard({ title, summary, loading }) {

  const statuses = [
    {
      label: 'Pending Payment',
      value: summary.pendingPayment,
      icon: faClock,
    },

    {
      label: 'Submitted',
      value: summary.submitted,
      icon: faFileCircleCheck,
    },

    {
      label: 'Payment Verified',
      value: summary.paymentVerified,
      icon: faCreditCard,
    },

    {
      label: 'Procurement',
      value: summary.procurement,
      icon: faCartShopping,
    },

    {
      label: 'Warehouse Preparation',
      value: summary.warehousePreparation,
      icon: faWarehouse,
    },

    {
      label: 'Ready for Shipment',
      value: summary.readyForShipment,
      icon: faTruckFast,
    },

    {
      label: 'Completed',
      value: summary.completed,
      icon: faCircleCheck,
    },
  ]


  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm">

      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">

        {/* =============================================
            TITLE
        ============================================= */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faBoxes} className={`h-5 w-5 ${loading ? 'animate-pulse' : ''}`}/>
          </div>

          <div>
            <h2 className="font-semibold text-gray-800">
              {title}
            </h2>

            <p className="text-xs text-gray-400">
              Order Status Overview
            </p>
          </div>
        </div>


        {/* =============================================
            TOTAL OVERALL ORDERS
        ============================================= */}
        <div className="flex items-center gap-8">
          <div className="text-left">
            <p className="text-xs text-gray-400">
              Total Active  Orders
            </p>

            <p className="text-xl font-bold text-[#1F3A2C]">
              {loading ? '-' : summary.totalActive}
            </p>
          </div>

          <div className="text-left">
            <p className="text-xs text-gray-400">
              Total Overall Orders
            </p>

            <p className="text-xl font-bold text-[#1F3A2C]">
              {loading ? '-' : summary.totalOverall}
            </p>
          </div>
        </div>
      </div>



      {/* =============================================
          STATUS BREAKDOWN
      ============================================= */}
      <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-3 sm:divide-y-0">
        {statuses.map((status, index) => (
          <div
            key={status.label}
            className={`
              flex items-center justify-between px-5 py-4
              ${index % 3 !== 2 ? 'sm:border-r sm:border-gray-100' : ''}
              ${index >= 3 ? 'sm:border-t sm:border-gray-100' : ''}
              ${index === 4 || index === 5 ? 'sm:border-b sm:border-gray-100' : ''}
            `}
          >

            {/* =============================================
                STATUS LABEL
            ============================================= */}
            <div className="flex items-center gap-3">

              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <FontAwesomeIcon
                  icon={status.icon}
                  className="h-4 w-4"
                />
              </div>

              <p className="text-sm font-medium text-gray-600">
                {status.label}
              </p>

            </div>


            {/* =============================================
                STATUS COUNT
            ============================================= */}
            <p className="text-lg font-semibold text-gray-800">
              {loading ? '-' : status.value}
            </p>

          </div>
        ))}
      </div>
    </div>
  )
}


// =============================================
// EMPTY FEATURE CARD
// =============================================
function EmptyFeatureCard({ title, icon, index }) {
  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-gray-200 bg-white shadow-sm">


      {/* =============================================
          HEADER
      ============================================= */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-white ${
            index === 0
              ? 'bg-blue-500'
              : index === 1
                ? 'bg-amber-500'
                : 'bg-gray-100 text-gray-500'
          }`}
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