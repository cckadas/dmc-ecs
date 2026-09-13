'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faXmark, faFloppyDisk, faClipboardCheck, faClock, faTriangleExclamation, faChartLine, faSquarePollVertical } from '@fortawesome/free-solid-svg-icons'


export default function SupplierPerformancePage() {

  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [performance, setPerformance] = useState(null)
  const [loadingPerformance, setLoadingPerformance] = useState(false)
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [savingRating, setSavingRating] = useState(false)


  // =============================================
  // LOAD SUPPLIERS
  // =============================================
  async function loadSuppliers() {

    setLoadingSuppliers(true)

    const { data, error } = await supabase
      .from('suppliers')
      .select(`
        id,
        supplier_name,
        supplier_type
      `)
      .order('supplier_name', { ascending: true })


    if (error) {
      console.error('Failed to load suppliers:', error)
      toast.error(error.message)
      setLoadingSuppliers(false)
      return
    }

    setSuppliers(data || [])
    setLoadingSuppliers(false)
  }


  // =============================================
  // LOAD SUPPLIER PERFORMANCE
  // =============================================
  async function loadSupplierPerformance(supplierId) {
    if (!supplierId) {
      setPerformance(null)
      return
    }

    setLoadingPerformance(true)

    try {

      // =============================================
      // LOAD SAVED PERFORMANCE RATING
      // =============================================
      const {
        data: performanceData,
        error: performanceError,
      } = await supabase
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
        .eq('supplier_id', supplierId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()


      if (performanceError) {
        throw performanceError
      }


      // =============================================
      // LOAD PURCHASE ORDERS FOR SUPPLIER
      // =============================================
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('purchase_order_items')
        .select(`
          purchase_order_id,
          supplier_id,
          purchase_orders (
            id,
            expected_delivery_date,
            updated_at,
            created_at,
            status
          )
        `)
        .eq('supplier_id', supplierId)

      if (orderItemsError) {
        throw orderItemsError
      }


      // =============================================
      // REMOVE DUPLICATE PURCHASE ORDERS
      // ONLY INCLUDE FULLY DELIVERED ORDERS
      // =============================================
      const uniqueOrders = []
      const seenOrderIds = new Set()

      ;(orderItems || []).forEach((item) => {
        const purchaseOrder = item.purchase_orders

        if (!purchaseOrder?.id) {
          return
        }

        if (purchaseOrder.status !== 'fully delivered') {
          return
        }

        if (seenOrderIds.has(purchaseOrder.id)) {
          return
        }

        seenOrderIds.add(purchaseOrder.id)
        uniqueOrders.push(purchaseOrder)
      })

      // =============================================
      // DETERMINE DELIVERY PERFORMANCE
      // =============================================
      let totalOrders = uniqueOrders.length
      let onTimeDeliveries = 0
      let lateDeliveries = 0
      let totalLeadTime = 0
      let leadTimeCount = 0

      uniqueOrders.forEach((order) => {
        if (!order.expected_delivery_date) {
          return
        }

        if (!order.updated_at) {
          return
        }

        const expectedDate = new Date(`${order.expected_delivery_date}T23:59:59`)
        const updatedDate = new Date(order.updated_at)

        // =========================================
        // ON TIME OR LATE
        // =========================================
        if (updatedDate <= expectedDate) {
          onTimeDeliveries++
        }

        else {
          lateDeliveries++
        }

        // =========================================
        // LEAD TIME
        // =========================================
        if (order.created_at) {
          const createdDate = new Date(order.created_at)
          const difference = updatedDate.getTime() - createdDate.getTime()
          const days = difference / (1000 * 60 * 60 * 24)

          if (days >= 0) {
            totalLeadTime += days
            leadTimeCount++
          }
        }
      })

      const averageLeadTime = leadTimeCount > 0 ? Number((totalLeadTime / leadTimeCount).toFixed(2)) : null


      // =============================================
      // USE ACTUAL CALCULATED VALUES
      // =============================================
      setPerformance({
        id: performanceData?.id || null,
        supplier_id: supplierId,
        total_orders: totalOrders,
        on_time_deliveries: onTimeDeliveries,
        late_deliveries: lateDeliveries,
        average_lead_time_days: averageLeadTime,
        reliability_rating: performanceData?.reliability_rating ?? null,
        notes: performanceData?.notes || '',
        created_at:  performanceData?.created_at || null,
        updated_at: performanceData?.updated_at || null,
      })
    }

    catch (error) {
      console.error('Failed to load supplier performance:', error)
      toast.error(error.message || 'Failed to load supplier performance.')
      setPerformance(null)
    }

    finally {
      setLoadingPerformance(false)
    }
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadSuppliers()
  }, [])

  useEffect(() => {
    loadSupplierPerformance(selectedSupplierId)
  }, [selectedSupplierId])


  // =============================================
  // SELECTED SUPPLIER
  // =============================================
  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId)


  // =============================================
  // OPEN RATING MODAL
  // =============================================
  function openRatingModal() {
    setShowRatingModal(true)
  }


  // =============================================
  // CLOSE RATING MODAL
  // =============================================
  function closeRatingModal() {
    if (savingRating) {
      return
    }

    setShowRatingModal(false)
  }


  // =============================================
  // SAVE SUPPLIER RATING
  // =============================================
  async function handleSaveRating(ratingData) {
    if (!ratingData.supplier_id) {
      toast.error('Please select a supplier.')
      return
    }

    if (ratingData.reliability_rating === null || ratingData.reliability_rating === undefined) {
      toast.error('Please provide a reliability rating.')
      return
    }

    setSavingRating(true)

    try {

      // =============================================
      // CHECK FOR EXISTING PERFORMANCE RECORD
      // =============================================
      const { data: existingPerformance, error: existingError } = await supabase
        .from('supplier_performance')
        .select('id')
        .eq('supplier_id', ratingData.supplier_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()


      if (existingError) {
        throw existingError
      }

      const performancePayload = {
        supplier_id: ratingData.supplier_id,
        total_orders: Number(ratingData.total_orders || 0),
        on_time_deliveries: Number(ratingData.on_time_deliveries || 0),
        late_deliveries: Number(ratingData.late_deliveries || 0),
        average_lead_time_days: ratingData.average_lead_time_days !== null ? Number(ratingData.average_lead_time_days) : null,
        reliability_rating: Number(ratingData.reliability_rating),
        notes: ratingData.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      }


      // =============================================
      // UPDATE EXISTING RECORD
      // =============================================
      if (existingPerformance?.id) {
        const { error: updateError } = await supabase
          .from('supplier_performance')
          .update(performancePayload)
          .eq('id', existingPerformance.id)

        if (updateError) {
          throw updateError
        }
      }

      // =============================================
      // INSERT NEW RECORD
      // =============================================
      else {
        const { error: insertError, } = await supabase
          .from('supplier_performance')
          .insert([ performancePayload ])

        if (insertError) {
          throw insertError
        }
      }


      // =============================================
      // SUCCESS
      // =============================================
      toast.success('Supplier performance rated successfully.')
      setShowRatingModal(false)

      if ( selectedSupplierId === ratingData.supplier_id) {
        await loadSupplierPerformance( ratingData.supplier_id)
      }
    }

    catch (error) {
      console.error('Failed to save supplier rating:', error)
      toast.error(error.message || 'Failed to save supplier rating.')
    }

    finally {
      setSavingRating(false)
    }
  }


  // =============================================
  // CALCULATE ON-TIME RATE
  // =============================================
  const onTimeRate = performance?.total_orders > 0 ? ((performance.on_time_deliveries / performance.total_orders) * 100).toFixed(1) : null


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* =============================================
          HEADER
      ============================================= */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Supplier Performance
          </h1>

          <p className="mt-1 text-gray-500">
            Monitor and evaluate supplier performance.
          </p>
        </div>

        <button
          type="button"
          onClick={openRatingModal}
          className="flex items-center gap-2 rounded-lg bg-[#1F3A2C] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#2D5A42]"
        >
          <FontAwesomeIcon icon={faSquarePollVertical} />
          Rate Supplier Performance
        </button>
      </div>


      {/* =============================================
          SUPPLIER SELECTOR
      ============================================= */}
      <div className="mb-6 w-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <label className="block text-sm font-semibold text-[#1F3A2C]">
            Select Supplier
          </label>

          <p className="mt-1 text-sm text-gray-500">
            Choose a supplier to view and evaluate their performance.
          </p>
        </div>

        <select
          value={selectedSupplierId}
          onChange={(e) => setSelectedSupplierId(e.target.value)}
          disabled={loadingSuppliers}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none transition hover:border-gray-400 focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="">
            {loadingSuppliers ? 'Loading suppliers...' : 'Select a supplier'}
          </option>

          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.supplier_name}
            </option>
          ))}
        </select>
      </div>


      {/* =============================================
          PERFORMANCE CARD
      ============================================= */}
      {selectedSupplier ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">


          {/* =============================================
              CARD HEADER
          ============================================= */}
          <div className="border-b bg-[#F4F8F5] px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#1F3A2C]">
                  {selectedSupplier.supplier_name}
                </h2>

                <p className="mt-0.5 text-sm text-gray-500">
                  {selectedSupplier.supplier_type}
                </p>
              </div>

              {performance?.reliability_rating !== null && performance?.reliability_rating !== undefined ? (
                <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow-sm">
                  <FontAwesomeIcon icon={faStar} className="text-lg text-amber-400" />

                  <span className="text-lg font-bold text-gray-700">
                    {Number(performance.reliability_rating).toFixed(1)} / 5
                  </span>
                </div>
              ) : (
                <span className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-500">
                  Not rated
                </span>
              )}
            </div>
          </div>



          {/* =============================================
              LOADING
          ============================================= */}
          {loadingPerformance ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">
                Calculating supplier performance...
              </p>
            </div>
          ) : (
            <div className="p-6">

              {/* =============================================
                  METRICS
              ============================================= */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <PerformanceMetricCard icon={faClipboardCheck} label="Total Orders" value={performance?.total_orders ?? 0}/>
                <PerformanceMetricCard icon={faClock} label="On-Time Deliveries" value={performance?.on_time_deliveries ?? 0}/>
                <PerformanceMetricCard icon={faTriangleExclamation} label="Late Deliveries" value={performance?.late_deliveries ?? 0}/>
              </div>

              {/* =============================================
                  DELIVERY SUMMARY
              ============================================= */}
              <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      Delivery Performance
                    </h3>

                    <p className="mt-0 text-sm text-gray-500">
                      Based on purchase order expected delivery dates and latest update dates.
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-600">
                      On-Time Rate
                    </span>

                    <span className="font-semibold text-gray-700">
                      {onTimeRate !== null ? `${onTimeRate}%` : '—'}
                    </span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-[#2D5A42] transition-all" style={{ width: `${Math.min(Number(onTimeRate || 0), 100)}%`, }}/>
                  </div>
                </div>
              </div>



              {/* =============================================
                  NOTES
              ============================================= */}
              {performance?.notes && (
                <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
                  <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Evaluation Notes
                  </p>

                  <p className="mt-2 text-sm leading-6 text-gray-700">
                    {performance.notes}
                  </p>
                </div>
              )}


              {/* =============================================
                  LAST UPDATED
              ============================================= */}
              {performance?.updated_at && (
                <p className="mt-5 text-sm text-gray-400">
                  Last evaluated{' '}
                  {new Date(performance.updated_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (

        /* =============================================
           NO SUPPLIER SELECTED
        ============================================= */
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center">
          <FontAwesomeIcon icon={faChartLine} className="mb-4 text-3xl text-gray-300"/>

          <p className="font-medium text-gray-600">
            Select a supplier
          </p>

          <p className="mt-1 text-sm text-gray-400">
            Choose a supplier above to view their performance.
          </p>
        </div>
      )}


      {/* =============================================
          RATING MODAL
      ============================================ */}

      {showRatingModal && (
        <SupplierRatingModal
          suppliers={suppliers}
          loadingSuppliers={loadingSuppliers}
          initialSupplierId={selectedSupplierId}
          onClose={closeRatingModal}
          onSubmit={handleSaveRating}
          saving={savingRating}
        />
      )}
    </div>
  )
}





// =============================================
// PERFORMANCE METRIC CARD
// =============================================
function PerformanceMetricCard({ icon, label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {label}
          </p>

          <p className="mt-2 text-2xl font-bold text-[#1F3A2C]">
            {value}
          </p>
        </div>

        <div className="rounded-lg bg-[#2D5A42] p-3 text-white">
          <FontAwesomeIcon icon={icon} className="h-5 w-5"/>
        </div>
      </div>
    </div>
  )
}





// =============================================
// SUPPLIER RATING MODAL
// =============================================
function SupplierRatingModal({ suppliers, loadingSuppliers, initialSupplierId, onClose, onSubmit, saving }) {

  const [supplierId, setSupplierId] = useState(initialSupplierId || '')

  const [metrics, setMetrics] = useState({
    total_orders: 0,
    on_time_deliveries: 0,
    late_deliveries: 0,
    average_lead_time_days: null,
  })

  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [rating, setRating] = useState(null)
  const [notes, setNotes] = useState('')


  // =============================================
  // LOAD METRICS
  // =============================================
  async function loadMetrics(selectedId) {
    if (!selectedId) {
      setMetrics({
        total_orders: 0,
        on_time_deliveries: 0,
        late_deliveries: 0,
        average_lead_time_days: null,
      })

      return
    }

    setLoadingMetrics(true)

    try {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(`
          purchase_order_id,
          purchase_orders (
            id,
            expected_delivery_date,
            updated_at,
            created_at
          )
        `)
        .eq('supplier_id', selectedId)

      if (error) {
        throw error
      }


      // =============================================
      // UNIQUE PURCHASE ORDERS
      // =============================================
      const uniqueOrders = []
      const seenOrderIds = new Set()

      ;(data || []).forEach((item) => {
        const order = item.purchase_orders

        if (!order?.id) {
          return
        }

        if (seenOrderIds.has(order.id)) {
          return
        }

        seenOrderIds.add(order.id)
        uniqueOrders.push(order)
      })

      let onTime = 0
      let late = 0
      let totalLeadTime = 0
      let leadTimeCount = 0

      uniqueOrders.forEach((order) => {
        if ( order.expected_delivery_date && order.updated_at) {

          const expectedDate = new Date(`${order.expected_delivery_date}T23:59:59`)
          const updatedDate = new Date(order.updated_at)

          if (updatedDate <= expectedDate) {
            onTime++
          }
          
          else {
            late++
          }


          // =========================================
          // LEAD TIME
          // =========================================
          if (order.created_at) {

            const createdDate = new Date(order.created_at)
            const difference = updatedDate.getTime() - createdDate.getTime()
            const days = difference / (1000 * 60 * 60 * 24)

            if (days >= 0) {
              totalLeadTime += days
              leadTimeCount++
            }
          }
        }
      })

      setMetrics({
        total_orders: uniqueOrders.length,
        on_time_deliveries: onTime,
        late_deliveries: late,
        average_lead_time_days: leadTimeCount > 0 ? Number((totalLeadTime / leadTimeCount).toFixed(2)) : null,
      })

      // =============================================
      // LOAD EXISTING RATING
      // =============================================
      const {  data: existingRating, error: ratingError } = await supabase
        .from('supplier_performance')
        .select(`
          reliability_rating,
          notes
        `)
        .eq('supplier_id', selectedId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (ratingError) {
        throw ratingError
      }

      setRating(existingRating?.reliability_rating !== null && existingRating?.reliability_rating !== undefined? Number(existingRating.reliability_rating): null)
      setNotes(existingRating?.notes || '')
    }

    catch (error) {
      console.error('Failed to calculate supplier metrics:', error)
    }

    finally {
      setLoadingMetrics(false)
    }
  }


  // =============================================
  // INITIAL MODAL LOAD
  // =============================================
  useEffect(() => {
    if (initialSupplierId) {
      loadMetrics(initialSupplierId)
    }
  }, [])


  // =============================================
  // SUPPLIER CHANGE
  // =============================================
  async function handleSupplierChange(e) {
    const value = e.target.value

    setSupplierId(value)
    setRating(null)
    setNotes('')

    await loadMetrics(value)
  }


  // =============================================
  // SUBMIT
  // =============================================
  function handleSubmit(e) {
    e.preventDefault()

    if (!supplierId) {
      console.error('Please select a supplier.')
      return
    }

    if (rating === null) {
      console.error('Please select a reliability rating.')
      return
    }

    onSubmit({
      supplier_id: supplierId,
      total_orders: metrics.total_orders,
      on_time_deliveries: metrics.on_time_deliveries,
      late_deliveries: metrics.late_deliveries,
      average_lead_time_days: metrics.average_lead_time_days,
      reliability_rating: rating,
      notes,
    })
  }


  // =============================================
  // SELECTED SUPPLIER
  // =============================================
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId)
  const modalOnTimeRate = metrics.total_orders > 0 ? ((metrics.on_time_deliveries / metrics.total_orders) * 100).toFixed(1) : '0.0'


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">


        {/* =============================================
            MODAL HEADER
        ============================================= */}
        <div className="flex items-start justify-between border-b bg-[#F4F8F5] px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">
              Rate Supplier
            </h2>

            <p className="mt-0.5 text-sm text-gray-500">
              Evaluate the supplier's reliability and delivery performance.
            </p>

          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-gray-500 transition hover:bg-white hover:text-gray-700 disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>


        {/* =============================================
            MODAL CONTENT
        ============================================= */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">

            {/* =============================================
                SUPPLIER
            ============================================= */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Supplier
              </label>

              <select
                value={supplierId}
                onChange={handleSupplierChange}
                disabled={ loadingSuppliers || saving}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-700 outline-none transition focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="">
                  {loadingSuppliers ? 'Loading suppliers...' : 'Select a supplier'}
                </option>

                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.supplier_name}
                  </option>
                ))}
              </select>
            </div>


            {selectedSupplier && (
              <>

                {/* =============================================
                    AUTOMATIC METRICS
                ============================================= */}
                <div>
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-800">
                      Delivery Performance
                    </h3>

                    <p className="mt- text-sm text-gray-500">
                      These values are automatically calculated from purchase orders.
                    </p>
                  </div>


                  {loadingMetrics ? (

                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-10 text-center">
                      <p className="text-sm text-gray-500">
                        Calculating delivery performance...
                      </p>
                    </div>

                  ) : (

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">

                      {/* TOTAL */}
                      <div className="rounded-xl border border-gray-200 p-4">
                        <p className="text-sm font-medium text-gray-500">
                          Total Orders
                        </p>

                        <p className="mt-2 text-2xl font-bold text-[#1F3A2C]">
                          {metrics.total_orders}
                        </p>
                      </div>


                      {/* ON TIME */}
                      <div className="rounded-xl border border-gray-200 p-4">
                        <p className="text-sm font-medium text-gray-500">
                          On-Time
                        </p>

                        <p className="mt-2 text-2xl font-bold text-green-700">
                          {metrics.on_time_deliveries}
                        </p>

                        <p className="mt-1 text-sm text-gray-400">
                          {modalOnTimeRate}%
                        </p>
                      </div>


                      {/* LATE */}
                      <div className="rounded-xl border border-gray-200 p-4">
                        <p className="text-sm font-medium text-gray-500">
                          Late
                        </p>

                        <p className="mt-2 text-2xl font-bold text-amber-600">
                          {metrics.late_deliveries}
                        </p>
                      </div>


                      {/* LEAD TIME */}
                      <div className="rounded-xl border border-gray-200 p-4">
                        <p className="text-sm font-medium text-gray-500">
                          Avg. Lead Time
                        </p>

                        <p className="mt-2 text-2xl font-bold text-[#1F3A2C]">
                          {metrics.average_lead_time_days !== null ? metrics.average_lead_time_days : '—'}
                        </p>

                        {metrics.average_lead_time_days !== null && (
                          <p className="mt-1 text-sm text-gray-400">
                            days
                          </p>
                        )}
                      </div>

                    </div>
                  )}
                </div>


                {/* =============================================
                    RELIABILITY RATING
                ============================================= */}
                <div>
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800">
                          Reliability Rating
                        </h3>

                        <p className="mt-0 text-sm text-gray-500">
                          How reliable would you consider this supplier?
                        </p>
                      </div>

                      {rating !== null && (
                        <span
                          className={`text-base font-semibold ${
                            rating === 1
                              ? 'text-red-600'
                              : rating === 2
                                ? 'text-orange-600'
                                : rating === 3
                                  ? 'text-yellow-600'
                                  : rating === 4
                                    ? 'text-blue-600'
                                    : 'text-green-600'
                          }`}
                        >
                          {rating === 1
                            ? 'Very Poor'
                            : rating === 2
                              ? 'Poor'
                              : rating === 3
                                ? 'Average'
                                : rating === 4
                                  ? 'Good'
                                  : 'Excellent'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((value) => {

                      const active = rating !== null && value <= rating

                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRating(value)}
                          disabled={saving}
                          className={`
                            flex flex-col items-center justify-center rounded-xl border px-3 py-4 transition
                            ${active ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:bg-gray-50'}
                          `}
                        >
                          <FontAwesomeIcon icon={faStar} className="text-xl"/>
                          <span className="mt-1 text-sm font-semibold">
                            {value}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>


                {/* =============================================
                    NOTES
                ============================================= */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">
                    Evaluation Notes
                    <span className="ml-1 font-normal text-gray-400">
                      (Optional)
                    </span>
                  </label>

                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    disabled={saving}
                    placeholder="Add notes about delivery reliability, communication, product quality, or other observations..."
                    className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20 disabled:bg-gray-100"
                  />
                </div>

              </>
            )}
          </div>


          {/* =============================================
              FOOTER
          ============================================= */}
          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving || !supplierId || rating === null || loadingMetrics}
              className="flex items-center gap-2 rounded-lg bg-[#1F3A2C] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2D5A42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FontAwesomeIcon icon={saving ? faClipboardCheck : faFloppyDisk}/>
              {saving ? 'Saving...' : 'Save Rating'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}