'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faXmark, faFloppyDisk, faClipboardCheck, faClock, faTriangleExclamation, faChartLine, faSquarePollVertical, faTruck } from '@fortawesome/free-solid-svg-icons'
import { loadSupplierScore } from '../services/supplierScoreService'
import { MIN_DELIVERIES, LATE_POINTS_PER_DAY } from '../utils/supplierScores'
import { deliveryHistory } from '../utils/analytics'
import { ChartCard, DeliveryHistoryChart, DeliveryHistoryTable } from '../components/AnalyticsCharts'


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
      // The delivery score is worked out from actual deliveries. The staff
      // rating and notes are what staff last saved for this supplier.
      const [score, { data: staffRating, error: ratingError }] = await Promise.all([
        loadSupplierScore(supplierId),
        supabase
          .from('supplier_performance')
          .select('id, reliability_rating, notes, updated_at')
          .eq('supplier_id', supplierId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (ratingError) {
        throw ratingError
      }

      setPerformance({ score, staffRating })
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
      toast.success('Staff rating saved.')
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
  // DISPLAYED VALUES
  // =============================================
  const score = performance?.score
  const staffRating = performance?.staffRating
  // Its deliveries in date order, for the delivery history chart.
  const pastDeliveries = score ? deliveryHistory(score.deliveries) : []


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
            Delivery scores worked out from actual deliveries, plus your staff rating.
          </p>
        </div>

        <button
          type="button"
          onClick={openRatingModal}
          className="flex items-center gap-2 rounded-lg bg-[#1F3A2C] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#2D5A42]"
        >
          <FontAwesomeIcon icon={faSquarePollVertical} />
          Add Staff Rating
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
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1F3A2C]">
                  {selectedSupplier.supplier_name}
                </h2>

                <p className="mt-0.5 text-sm text-gray-500">
                  {selectedSupplier.supplier_type}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                {!loadingPerformance && <ScoreBadge score={score}/>}

                {staffRating?.reliability_rating !== null && staffRating?.reliability_rating !== undefined && (
                  <span className="flex items-center gap-1.5 text-xs text-gray-500">
                    <FontAwesomeIcon icon={faStar} className="text-amber-400" />
                    Staff rating {Number(staffRating.reliability_rating).toFixed(1)} / 5
                  </span>
                )}
              </div>
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <PerformanceMetricCard icon={faTruck} label="Deliveries" value={score?.count ?? 0} note="Last 12 months"/>
                <PerformanceMetricCard icon={faClipboardCheck} label="On-Time Rate" value={formatPercent(score?.onTimeRate)} note={score?.count ? `${score.onTimeCount} on time, ${score.lateCount} late` : null}/>
                <PerformanceMetricCard icon={faClock} label="Usual Lead Time" value={formatDays(score?.usualLeadDays)} note={leadRangeNote(score)}/>
                <PerformanceMetricCard icon={faTriangleExclamation} label="Average Days Late" value={score?.lateCount ? formatDays(score.averageDaysLate) : '—'} note={!score?.count ? null : score.lateCount ? 'Of the late deliveries' : 'None late'}/>
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
                      Each delivery's received date compared with the date its PO promised, over the last 12 months.
                      The score is the on-time rate minus {LATE_POINTS_PER_DAY} points for each average day late,
                      once a supplier has {MIN_DELIVERIES} deliveries.
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-600">
                      On-Time Rate
                    </span>

                    <span className="font-semibold text-gray-700">
                      {formatPercent(score?.onTimeRate)}
                    </span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-[#2D5A42] transition-all" style={{ width: `${Math.min((score?.onTimeRate || 0) * 100, 100)}%`, }}/>
                  </div>
                </div>
              </div>


              {/* =============================================
                  DELIVERY HISTORY
              ============================================= */}
              {pastDeliveries.length > 0 && (
                <div className="mt-6">
                  <ChartCard
                    title="Delivery History"
                    question="Is this supplier getting better or worse?"
                    table={<DeliveryHistoryTable deliveries={pastDeliveries} />}
                    footnote="One bar per delivery, in date order: above the line when it came late, below when early, by the number of days. A run of bars above the line means the supplier is slipping."
                  >
                    <DeliveryHistoryChart deliveries={pastDeliveries} />
                  </ChartCard>
                </div>
              )}


              {/* =============================================
                  RECENT DELIVERIES
              ============================================= */}
              {score?.count > 0 ? (
                <div className="mt-6">
                  <h3 className="mb-3 font-semibold text-gray-800">
                    Recent Deliveries
                  </h3>

                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-2.5">PO</th>
                          <th className="px-4 py-2.5">Ordered</th>
                          <th className="px-4 py-2.5">Promised</th>
                          <th className="px-4 py-2.5">Received</th>
                          <th className="px-4 py-2.5">Lead Time</th>
                          <th className="px-4 py-2.5">Result</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-gray-100">
                        {score.deliveries.slice(0, 10).map((delivery) => (
                          <tr key={delivery.purchaseOrderId}>
                            <td className="px-4 py-2.5 font-medium text-gray-800">{delivery.poNumber || '—'}</td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDay(delivery.orderedOn)}</td>
                            <td className="px-4 py-2.5 text-gray-600">{delivery.promised ? formatDay(delivery.promised) : '—'}</td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDay(delivery.receivedOn)}</td>
                            <td className="px-4 py-2.5 text-gray-600">{formatDays(delivery.leadDays)}</td>
                            <td className="px-4 py-2.5">
                              {delivery.onTime === null ? (
                                <span className="text-gray-400">No promised date</span>
                              ) : delivery.onTime ? (
                                <span className="font-medium text-green-700">On time</span>
                              ) : (
                                <span className="font-medium text-red-700">{formatDays(delivery.daysLate)} late</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {score.count > 10 && (
                    <p className="mt-2 text-xs text-gray-400">
                      Showing the latest 10 of {score.count} deliveries.
                    </p>
                  )}
                </div>
              ) : score && (
                <p className="mt-6 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                  No finished deliveries from this supplier in the last 12 months.
                </p>
              )}



              {/* =============================================
                  NOTES
              ============================================= */}
              {staffRating?.notes && (
                <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
                  <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Staff Notes
                  </p>

                  <p className="mt-2 text-sm leading-6 text-gray-700">
                    {staffRating.notes}
                  </p>
                </div>
              )}


              {/* =============================================
                  LAST UPDATED
              ============================================= */}
              {staffRating?.updated_at && (
                <p className="mt-5 text-sm text-gray-400">
                  Staff rating last saved{' '}
                  {new Date(staffRating.updated_at).toLocaleString()}
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
// FORMATTING
// =============================================
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`)

const formatDays = (value) => {
  if (value === null || value === undefined) return '—'
  const shown = Number.isInteger(value) ? value : Number(value.toFixed(1))
  return `${shown} ${shown === 1 ? 'day' : 'days'}`
}

// The middle half of a supplier's lead times, in whole days.
const leadRangeNote = (score) => {
  if (score?.leadLow === null || score?.leadLow === undefined) return null
  const low = Math.round(score.leadLow)
  const high = Math.round(score.leadHigh)
  return low === high ? `Middle half: ${formatDays(low)}` : `Middle half: ${low} to ${high} days`
}

// A YYYY-MM-DD date, e.g. "Nov 4, 2026".
const formatDay = (date) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })


// =============================================
// DELIVERY SCORE BADGE
// =============================================
const BAND_STYLES = {
  good: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
}

function ScoreBadge({ score }) {
  if (!score) return null

  if (!score.enough) {
    return (
      <span className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-500">
        Not enough deliveries yet ({score.count} of {MIN_DELIVERIES})
      </span>
    )
  }

  return (
    <span className={`rounded-xl px-4 py-2 text-sm font-semibold shadow-sm ${BAND_STYLES[score.band.tone]}`}>
      Score {score.score} / 100 · {score.band.label}
    </span>
  )
}


// =============================================
// PERFORMANCE METRIC CARD
// =============================================
function PerformanceMetricCard({ icon, label, value, note }) {
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

          {note && (
            <p className="mt-1 text-xs text-gray-400">
              {note}
            </p>
          )}
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
      const score = await loadSupplierScore(selectedId)

      // Saved with the staff rating as a snapshot of the delivery numbers then.
      setMetrics({
        total_orders: score.count,
        on_time_deliveries: score.onTimeCount,
        late_deliveries: score.lateCount,
        average_lead_time_days: score.usualLeadDays,
        on_time_rate: score.onTimeRate,
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
  const modalOnTimeRate = formatPercent(metrics.on_time_rate)


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">


        {/* =============================================
            MODAL HEADER
        ============================================= */}
        <div className="flex items-start justify-between border-b bg-[#F4F8F5] px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">
              Staff Rating
            </h2>

            <p className="mt-0.5 text-sm text-gray-500">
              For what delivery dates can't show, like product quality or communication. It doesn't change the delivery score.
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
                      Worked out from this supplier's deliveries in the last 12 months.
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
                          Deliveries
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
                          {modalOnTimeRate}
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
                          Usual Lead Time
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
                          Staff Rating
                        </h3>

                        <p className="mt-0 text-sm text-gray-500">
                          How would you rate this supplier overall?
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
                    Staff Notes
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
              {saving ? 'Saving...' : 'Save Staff Rating'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}