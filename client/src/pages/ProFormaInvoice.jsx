'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { createNotification } from '../services/notificationService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faFileSignature, faXmark, faDownload, faFileInvoice } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"
import { generatePFI } from '../services/pfiService'
import { localDateExcludingSundays, formatDateString, QUOTATION_VALIDITY_DAYS, formatDateTime } from '../utils/dates'
import { getQuotationPricing, pricingErrorMessage } from '../services/pricingService'
import { containerCount, containerText, formatVolume, formatWeight } from '../utils/containers'
import { previewEstimate } from '../services/predictionService'
import { creditRoom, formatPeso, getCreditStatus, overLimitBy } from '../services/creditService'
import { loadCarriedFrom, loadWaitingGoods, waitingState } from '../services/rushService'
import { formatDay } from '../utils/paymentDeadline'
import { RUSH_ITEM_COLUMNS, columnsIf, isMissingColumn, withNewColumns } from '../utils/newColumns'

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'
import TableScroll from '../components/TableScroll'
import ListControls from '../components/ListControls'
import { dateTime, day, exportList, productsText, statusText } from '../utils/csvExport'
import { ALL, applySearch, applyShow, applySort, byNewest, byOldest, byStatus, showChoices, showingOf } from '../utils/listControls'


export default function ProFormaInvoicePage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [showModal, setShowModal] = useState(false)
  const [requests, setRequests] = useState([])
  // Show (a request status), Sort by and Search, above the list.
  const [show, setShow] = useState(ALL)
  const [sortBy, setSortBy] = useState('status')
  const [search, setSearch] = useState('')
  const [currentRequest, setCurrentRequest] = useState(null)
  const [currentQuotation, setCurrentQuotation] = useState(null)
  const [creatingQuotation, setCreatingQuotation] = useState(false)
  // Each request's newest delivery location change by its customer (037).
  const [locationChanges, setLocationChanges] = useState({})


  // =============================================
  // LOAD QUEUES
  // =============================================
  async function loadQueues() {
    // Which request a new quote replaces (035) and whether it's on hold for the
    // customer's credit limit (040), asked for until those scripts are run.
    const { data, error } = await withNewColumns((withHold) => withNewColumns((withLink) => supabase
      .from('quotation_requests')
      .select(`
        id,
        quotation_reference,
        preferred_ship_date,
        delivery_location_id,
        ${columnsIf(withLink, ['replaces_request_id'])}
        ${columnsIf(withHold, ['credit_hold_at', 'credit_hold_by_name'])}
        status,
        created_at,
        profiles (
          id,
          company,
          email,
          contact_number,
          address
        ),
        delivery_locations (
          location_name,
          contact_number,
          address,
          country
        ),
        quotation_request_items (
          id,
          quantity,
          notes,
          products (
            id,
            product_name,
            brand,
            unit,
            supplier_id,
            cbm,
            gross_weight_kg
          )
        )
      `)
      .order('created_at', { ascending: false }), ['replaces_request_id']), ['credit_hold_at'])


    if (error) {
      toast.error(error.message)
      return
    }

    setRequests(data || [])

    // The customers' delivery location changes (037; none before it's run): the newest per request.
    const { data: changes, error: changesError } = await supabase
      .from('quotation_request_location_changes')
      .select('quotation_request_id, from_text, withdrawn_quotation_id, changed_at')
      .order('changed_at', { ascending: true })
    if (!changesError) setLocationChanges(Object.fromEntries((changes || []).map((change) => [change.quotation_request_id, change])))
  }


  // =============================================
  // CREATE QUOTATION
  // =============================================
  async function generateQuotation(data) {
    
    setCreatingQuotation(true)

    try {
      // The customer may have changed the request (its delivery location, say,
      // 037) while it was being priced: then nothing is saved.
      const { data: fresh } = await supabase
        .from('quotation_requests')
        .select('delivery_location_id, status')
        .eq('id', currentRequest.id)
        .maybeSingle()

      if (fresh && (fresh.delivery_location_id !== currentRequest.delivery_location_id
        || String(fresh.status || '').trim().toLowerCase() !== 'awaiting pricing')) {
        toast.error(`The customer changed ${currentRequest.quotation_reference} while you were pricing it (its delivery location or status). Nothing was saved: open it again to price it as it is now.`)
        setShowModal(false)
        loadQueues()
        return
      }

      // Create quotation. The database gives it its number (QT-2026-00001), its
      // fixed expiry date, and sets the container and shipping costs itself.
      const row = {
        quotation_request_id: currentRequest.id,
        subtotal: data.subtotal,
        container_size: data.containerSize,
        container_cost: data.containerCost,
        shipping_cost: data.shippingCost,
        total_amount: data.total,
        down_payment_amount: data.downPayment,
        expiry_date: data.expiryDate,
        status: 'pending approval',
      }
      // Its containers (044). One container can still be saved before 044 is run.
      const insertQuotation = (values) => supabase.from('quotations').insert(values).select().single()
      let { data: quotation, error } = await insertQuotation({ ...row, container_plan: data.containerPlan })
      if (error && isMissingColumn(error, ['container_plan'])) {
        if ((data.containerPlan || []).reduce((total, entry) => total + entry.count, 0) > 1) {
          toast.error('An order that needs more than one container can be quoted once db/migrations/044 is run.')
          return
        }
        ;({ data: quotation, error } = await insertQuotation(row))
      }

      if (error) {
        console.error(error)
        // The database's own reason, e.g. the expiry-date rule.
        toast.error(error.message || 'Failed to generate the quotation.')
        return
      }

      // Create quotation items. Goods waiting from a rush shipment are ₱0
      // lines that name the earlier order's line they carry (034); approving
      // checks them. Left out when there are none, as before 034.
      const carries = data.items.some((item) => item.carried_from_item_id)
      const quotationItems = data.items.map((item) => ({
        quotation_id: quotation.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.quantity * item.unit_price,
        ...(carries ? { carried_from_item_id: item.carried_from_item_id || null } : {}),
      }))

      const { error: itemError } = await supabase
        .from('quotation_items')
        .insert(quotationItems)

      if (itemError) {
        toast.error(itemError.message)

        // Roll back quotation if item insert fails
        await supabase
          .from('quotations')
          .delete()
          .eq('id', quotation.id)

        return
      }


      // 3. Generate PFI
      const pfiData = {
        ...quotation,

        // Profile
        profile_phone: profile?.contact_number || '-',
        profile_email: profile?.email || '-',

        // Customer
        customer_name: currentRequest.profiles?.company || '-',

        // Delivery
        customer_address: currentRequest.delivery_locations?.address || '-',
        customer_phone: currentRequest.delivery_locations?.contact_number || '-',
        customer_email: currentRequest.profiles?.email || '-',
        customer_country: currentRequest.delivery_locations?.country || '-',

        // Shipping
        shipping_to: currentRequest.delivery_locations?.address || '-',
        shipping_location: currentRequest.delivery_locations?.location_name || '-',

        // Quotation
        delivery_method: 'Standard',
      }

      const pfi = await generatePFI(pfiData, data.items)

      const pdfBlob = pfi.output('blob')


      // 4. Upload PFI to Supabase Storage
      const filePath = `pfi/${quotation.quotation_number}-PFI.pdf`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (uploadError) {
        console.error(uploadError)
        toast.error('PFI upload failed.')
        return
      }


      // 5. Save PFI path to quotation
      const { error: pathError } = await supabase
        .from('quotations')
        .update({
          pfi_file_path: filePath,
        })
        .eq('id', quotation.id)

      if (pathError) {
        console.error(pathError)
        toast.error('Could not attach PFI to quotation.')
        return
      }


      // 6. Update quotation request
      const { error: requestError } = await supabase
        .from('quotation_requests')
        .update({
          status: 'priced & sent to customer',
        })
        .eq('id', currentRequest.id)

      if (requestError) {
        toast.error('Failed to update request status.')
        return
      }


      // =============================================
      // SUCCESS
      // =============================================
      await createNotification({
        userId: currentRequest.profiles?.id,
        role: 'customer',
        title: `${currentRequest.quotation_reference} PFI now available`,
        message: `PFI for Quotation Request ${currentRequest.quotation_reference} is ready for review.`,
        type: 'info',
        link: '/quotation-requests',
      })

      toast.success('Quotation and PFI generated successfully.')

      setShowModal(false)
      setCurrentRequest(null)

      await loadQueues()
    }

    catch {
      toast.error( 'Failed to create quotation.')
    }

    finally {
      setCreatingQuotation(false)
    }
  }


  // =============================================
  // OPEN QUOTATION MODAL
  // =============================================
  // =============================================
  // PUT ON HOLD UNTIL THE CUSTOMER PAYS (040)
  // Its total would take the customer over the credit limit if approved.
  // =============================================
  async function holdRequest(request) {
    const { data, error } = await supabase.rpc('hold_request_for_credit', { p_request_id: request.id })

    if (error) {
      toast.error(error.code === 'PGRST202' || /hold_request_for_credit/.test(error.message || '')
        ? 'Putting a request on hold needs db/migrations/040 to be run first.'
        : error.message)
      return
    }

    toast.success(`${request.quotation_reference} is on hold until the customer pays. You'll be told when their balance goes down.${data?.already ? ' (It was already on hold.)' : ''}`)
    setShowModal(false)
    setCurrentRequest(null)
    loadQueues()
  }


  async function openInfoModal(request) {
    setCurrentRequest(request)

    if (request.status === 'awaiting pricing') {
      setShowModal(true)
      return
    }

    // Every other status has a quotation on record, kept even after it's
    // answered. Its lines for waiting goods (034) are asked for until then.
    const { data, error } = await withNewColumns((withPlan) => withNewColumns((withRush) => supabase
      .from('quotations')
      .select(`
        id,
        quotation_request_id,
        quotation_number,
        subtotal,
        container_size,
        ${columnsIf(withPlan, ['container_plan'])}
        container_cost,
        shipping_cost,
        total_amount,
        down_payment_amount,
        expiry_date,
        status,
        created_at,
        pfi_file_path,
        quotation_items (
          id,
          product_id,
          quantity,
          unit_price,
          subtotal,
          ${columnsIf(withRush, ['carried_from_item_id'])}
          products (
            product_name,
            brand,
            unit
          )
        )
      `)
      .eq('quotation_request_id', request.id)
      // Its newest: an earlier one may have been withdrawn when the customer
      // changed the delivery location (037).
      .order('created_at', { ascending: false })
      .limit(1)
      .single(), RUSH_ITEM_COLUMNS), ['container_plan'])

    if (error) {
      toast.error('Failed to load quotation.')
      return
    }

    const carriedFrom = await loadCarriedFrom(data.quotation_items)
    setCurrentQuotation({
      ...data,
      quotation_items: (data.quotation_items || []).map((item) => ({
        ...item,
        carried_from: item.carried_from_item_id ? carriedFrom.get(item.carried_from_item_id) || 'an earlier order' : null,
      })),
    })
    setShowModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadQueues()
    }
  }, [profile])


  // =============================================
  // MAIN CONTENT
  // =============================================
  // The list as chosen above it. By status: awaiting pricing first, the one
  // waiting longest first.
  const REQUEST_ORDER = ['awaiting pricing', 'priced & sent to customer', 'approved', 'rejected', 'expired', 'cancelled']
  const requestList = { statusOf: (request) => request.status, order: REQUEST_ORDER, allLabel: 'All requests' }
  const choices = showChoices(requests, requestList)
  const showing = showingOf(choices, show)
  const byWaiting = byOldest((request) => request.created_at)
  const shownRequests = applySort(
    applySearch(applyShow(requests, showing, requestList), search, (request) => [request.quotation_reference, request.profiles?.name, request.profiles?.company].join(' ')),
    sortBy,
    {
      status: (a, b) => byStatus((request) => request.status, REQUEST_ORDER, () => null)(a, b) || byWaiting(a, b),
      oldest: byWaiting,
      newest: byNewest((request) => request.created_at),
    }
  )

  return (
    <div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            PFI Builder
          </h1>

          <p className="mt-1 text-gray-500">
            View customers' quotation requests and generate PFI.
          </p>
        </div>
      </div>


      <ListControls
        choices={choices}
        show={showing}
        onShow={setShow}
        sorts={[
          { value: 'status', label: 'Status (awaiting pricing first, waiting longest first)' },
          { value: 'oldest', label: 'Oldest first (waiting longest)' },
          { value: 'newest', label: 'Newest first' },
        ]}
        sortBy={sortBy}
        onSort={setSortBy}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Reference or customer"
        shown={shownRequests.length}
        total={requests.length}
        onExport={(how) => exportList(how, 'quotation-requests', requestColumns(requests), shownRequests)}
        noun={requests.length === 1 ? 'request' : 'requests'}
      />


      {/* Table */}
      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Reference
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Company
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Location
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Date Requested
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Action
              </th>
            </tr>
          </thead>


          <tbody>
            {shownRequests.length > 0 ? (
              shownRequests.map((request) => (
                <tr
                  key={request.id}
                  className="border-t border-gray-200 text-sm hover:bg-gray-50"
                >

                  <td className="px-5 py-3 font-medium text-gray-800">
                    {request.quotation_reference}
                    {request.replaces_request_id && (
                      <span className="mt-0.5 block text-xs font-normal text-gray-500">
                        New quote for {requests.find((other) => other.id === request.replaces_request_id)?.quotation_reference || 'an expired request'} (its quotation expired)
                      </span>
                    )}
                    {requests.some((other) => other.replaces_request_id === request.id) && (
                      <span className="mt-0.5 block text-xs font-normal text-gray-500">
                        New quote requested: {requests.find((other) => other.replaces_request_id === request.id).quotation_reference}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    {request.profiles?.company || '-'}
                  </td>

                  <td className="px-5 py-3">
                    {request.delivery_locations?.location_name || '-'}
                    {locationChanges[request.id] && (
                      <span className="mt-0.5 block max-w-[14rem] text-xs text-amber-700">
                        Changed by the customer {formatDateTime(locationChanges[request.id].changed_at)}, from {locationChanges[request.id].from_text}
                        {locationChanges[request.id].withdrawn_quotation_id ? ': price it again' : ''}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    {request.delivery_locations?.contact_number || '-'}
                  </td>

                  <td className="px-5 py-3">
                    <StatusBadge status={request.status} />
                    {request.credit_hold_at && request.status === 'awaiting pricing' && (
                      <span className="mt-1 block text-xs font-medium text-amber-700">On hold: over the credit limit</span>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    {formatDateTime(request.created_at)}
                  </td>

                  <td className="px-5 py-3">
                    {request.status === 'awaiting pricing' ? (
                      <IconButton icon={faFileSignature} title="View Quotation" color="amber" disabled={false} onClick={() => openInfoModal(request)}/>
                    ) : (
                      <IconButton icon={faFolderOpen} title="View Quotation" color="blue" disabled={false} onClick={() => openInfoModal(request)}/>
                    )}
                  </td>

                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan="6"
                  className="py-10 text-center text-sm text-gray-500"
                >
                  {requests.length > 0 ? 'Nothing matches what is chosen above.' : 'No quotation requests found.'}
                </td>
              </tr>
            )}

          </tbody>
        </table>
      </TableScroll>


      {showModal && currentRequest?.status === 'awaiting pricing' && (
        <QuotationModal
          request={currentRequest}
          creating={creatingQuotation}
          onClose={() => {
            if (creatingQuotation) { return }
            setShowModal(false)
            setCurrentRequest(null)
          }}
          onSubmit={generateQuotation}
          onHold={holdRequest}
        />
      )}

      {showModal && currentRequest && currentRequest.status !== 'awaiting pricing' && (
        <QuotationViewModal
          quotation={currentQuotation}
          onClose={() => {
            setShowModal(false)
            setCurrentRequest(null)
            setCurrentQuotation(null)
          }}
        />
      )}
    </div>
  )
}


// =====================================================
// VIEW CUSTOMER ORDER MODAL
// =====================================================
function QuotationViewModal({ quotation, onClose }) {

  // =============================================
  // DOWNLOAD PFI
  // =============================================
  async function downloadPFI() {
    if (!quotation?.pfi_file_path) {
      alert('PFI file is not available.')
      return
    }

    console.log(quotation.pfi_file_path)

    const { data, error } = await supabase.storage
      .from('documents')
      .download(quotation.pfi_file_path)

    if (error) {
      console.error(error)
      alert('Failed to download PFI.')
      return
    }

    const url = URL.createObjectURL(data)

    const link = document.createElement('a')
    link.href = url
    link.download = `${quotation.quotation_number}-PFI.pdf`

    document.body.appendChild(link)
    link.click()
    link.remove()

    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {quotation.quotation_number}
            </h2>

            <p className="text-sm text-gray-500">
              Quotation
            </p>
          </div>

          <button onClick={onClose} className=" rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>


        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="flex-1 overflow-y-auto p-6">


          {/* =================================================
              ORDER INFORMATION
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Quotation Information
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Quotation Number </p>
              <p className="mt-1 font-medium text-gray-800"> {quotation.quotation_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <p className="mt-1 font-medium text-gray-800"> <StatusBadge status={quotation.status}/> </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Expiry Date </p>
              <p className="mt-1 font-medium text-gray-800"> {new Date(quotation.expiry_date).toLocaleDateString()} </p>
            </div>        

            <div>
              <p className="text-xs uppercase text-gray-500"> Date Created </p>
              <p className="mt-1 font-medium text-gray-800"> {formatDateTime(quotation.created_at)} </p>
            </div>
          </div>


          {/* =================================================
              ITEMS
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Quotation Items
          </h3>

          <TableScroll className="rounded-lg border">
            <table className=" min-w-full">

              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Product
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Quantity
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Unit
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Unit Price
                  </th>

                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                    Subtotal
                  </th>
                </tr>
              </thead>

              <tbody>
                {quotation.quotation_items.map((item) => (
                  <tr key={item.id} className="border-t border-gray-200">

                    {/* PRODUCT */}
                    <td className="px-4 py-4">
                      <p className="font-medium text-gray-800">
                        {item.products?.product_name}
                      </p>

                      {item.products?.brand && (
                        <p className="text-xs text-gray-500">
                          {item.products.brand}
                        </p>
                      )}

                      {item.carried_from && (
                        <p className="mt-0.5 text-xs font-medium text-amber-700">
                          From {item.carried_from} (rush shipment): already paid
                        </p>
                      )}
                    </td>


                    {/* QUANTITY */}
                    <td className="px-4 py-4 text-left">
                      {item.quantity}
                    </td>


                    {/* UNIT */}
                    <td className="px-4 py-4 text-left">
                      {item.products.unit}
                    </td>


                    {/* UNIT PRICE */}
                    <td className="px-4 py-4 text-left">
                      ₱ {Number(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>


                    {/* SUBTOTAL */}
                    <td className="px-4 py-4 text-right">
                      ₱ {Number(item.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>
          </TableScroll>


          {/* =================================================
              SUMMARY
          ================================================= */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-sm">
          
              <h3 className="mb-3 text-sm font-semibold text-gray-800">
                Order Summary
              </h3>

              <div className="rounded-lg bg-gray-50 p-5">
                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Subtotal
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(quotation.subtotal || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2
                    })}
                  </span>
                </div>

                {quotation.container_cost != null && (
                  <div className="mb-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-700">
                      Container{containerCount(quotation) > 1 ? 's' : ''} ({containerText(quotation)})
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(quotation.container_cost).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>
                )}

                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping Cost
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(quotation.shipping_cost || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2
                    })}
                  </span>
                </div>

                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-xl font-bold text-gray-800">
                      ₱ {Number(quotation.total_amount || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-green-700">
                      Down Payment
                    </span>

                    <span className="text-lg font-bold text-green-800">
                      ₱ {Number(quotation.down_payment_amount || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>
                </div>
              </div>
              
            </div>
          </div>
        </div>


        {/* =================================================
            FOOTER
        ================================================= */}
        <div className="flex items-center justify-end gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={downloadPFI}
            disabled={!quotation?.pfi_file_path}
            className="ml-6 flex shrink-0 items-center gap-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faDownload} className="mr-2" />
            Download PFI
          </button>

          <button 
            type="button" 
            onClick={onClose} 
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  )
}






// =====================================================
// ADD PURCHASE ORDER MODAL
// =====================================================
// =============================================
// SHIP DATE CHECK
//
// For sales, before the quotation goes out: when the order would likely ship
// if paid today, and whether that meets the customer's preferred date.
// =============================================
function ShipEstimateCheck({ estimate, preferredDate }) {
  const fullDate = (date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const shortDate = (date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const late = estimate.daysPastRequested > 0
  const preferred = preferredDate ? fullDate(`${preferredDate}T00:00:00`) : null

  return (
    <div className={`mb-6 rounded-lg border p-4 text-sm ${late ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
      <p className="font-medium text-gray-800">
        If the customer pays the down payment today, it ships around {fullDate(estimate.estimatedShipDate)}
        {estimate.shipDateRange && (
          <span className="font-normal text-gray-600">
            {' '}· likely {shortDate(estimate.shipDateRange.quick)} to {shortDate(estimate.shipDateRange.slow)}
          </span>
        )}
      </p>

      {late ? (
        <p className="mt-1 font-medium text-amber-800">
          That's {estimate.daysPastRequested} {estimate.daysPastRequested === 1 ? 'day' : 'days'} after their preferred date ({preferred}).
          Tell the customer before sending the quotation, or agree on a later date.
        </p>
      ) : preferred ? (
        <p className="mt-1 text-green-800">On track for their preferred date ({preferred}).</p>
      ) : null}

      <p className="mt-1 text-xs text-gray-500">
        {estimate.confidence}% confidence{estimate.roughEstimate ? ' · rough estimate: few finished orders to learn from yet' : ''}
      </p>
    </div>
  )
}


// onHold(request): puts it on hold until the customer pays (040), when its
// total would take them over the credit limit if they approved it.
function QuotationModal({ request, creating, onClose, onSubmit, onHold }) {
  // The customer's unpaid balance and credit limit, for the hold check.
  const [credit, setCredit] = useState(null)

  useEffect(() => {
    let active = true
    if (request.profiles?.id) {
      getCreditStatus(request.profiles.id)
        .then((status) => { if (active) setCredit(status) })
        .catch((error) => console.error('Failed to load the customer\'s credit status:', error))
    }
    return () => { active = false }
  }, [request.profiles?.id])

  // Fixed, like the prices: the country's shipping cost, and the cost of the
  // container the order needs: the smallest that holds it, worked out from each
  // product's volume and weight per case. Nobody picks it (DMC, Nov 2026).
  const [shipping, setShipping] = useState({ cost: null, source: '' })
  const [containers, setContainers] = useState(null)
  const [containerCode, setContainerCode] = useState('')
  // DMC: a quotation is valid for exactly 7 days, Sundays not counted. Fixed,
  // not chosen, so it can't be set wrong; the database sets the same date
  // itself when the quotation is saved (db/migrations/009).
  const expiryDate = localDateExcludingSundays(QUOTATION_VALIDITY_DAYS)
  const [items, setItems] = useState(
    request.quotation_request_items.map((item) => ({
      id: item.id,
      product_id: item.products.id,
      product_name: item.products.product_name,
      brand: item.products.brand,
      quantity: item.quantity,
      notes: item.notes,
      unit: item.products.unit,
      supplier_id: item.products.supplier_id,

      // Filled in from the price list and markup below; never typed.
      unit_price: null,
      price_source: '',
      moq: null,
    }))
  )
  const [pricingError, setPricingError] = useState('')
  const [loadingPrices, setLoadingPrices] = useState(true)
  // The customer's goods waiting from a rush shipment (034), not yet joined
  // to an order: they go in this quotation's container, at ₱0.
  const carriedItems = items.filter((item) => item.carried_from_item_id)
  // The soonest last day the customer can approve it to keep them (041).
  const approveBy = carriedItems.map((item) => item.approve_by).filter(Boolean).sort()[0] || null


  // ===================================================
  // SHIP DATE ESTIMATE
  //
  // When the order would likely ship if the customer paid the down payment
  // today, against the date they asked for: the same estimate the customer
  // sees on the quotation (utils/predictions.js).
  // ===================================================
  const [shipEstimate, setShipEstimate] = useState(null)

  useEffect(() => {
    let active = true

    previewEstimate({
      items: request.quotation_request_items.map((item) => ({ product_id: item.products.id, quantity: item.quantity })),
      deliveryLocationId: request.delivery_location_id,
      requestedShipDate: request.preferred_ship_date,
      // Labeling takes longer for a new customer or product, and a 40-ft.
      customerId: request.profiles?.id || null,
      containerSize: containerCode || null,
    })
      .then((estimate) => { if (active) setShipEstimate(estimate) })
      .catch((error) => console.error('Failed to estimate the ship date:', error))

    return () => { active = false }
  }, [request.id, containerCode])


  // ===================================================
  // SELLING PRICES, CONTAINER AND SHIPPING
  //
  // Fixed: supplier price + the destination country's markup, the container
  // size's cost, and the country's shipping cost (or the Default rates). Sales
  // can't type any of them, so a wrong one can't be sent by accident or on
  // purpose.
  // ===================================================
  useEffect(() => {
    let active = true

    async function loadPrices() {
      try {
        // What waits from the customer's rush shipments, not taken by an order yet.
        const waiting = request.profiles?.id
          ? (await loadWaitingGoods(request.profiles.id)).filter((row) => waitingState(row) === 'waiting')
          : []

        const { prices, shipping: shippingPrice, containers: containerPlan } = await getQuotationPricing({
          country: request.delivery_locations?.country,
          lines: request.quotation_request_items.map((item) => ({
            productId: item.products.id,
            supplierId: item.products.supplier_id,
            quantity: item.quantity,
            name: item.products.product_name,
            cbm: item.products.cbm,
            grossWeightKg: item.products.gross_weight_kg,
          })),
          carriedLines: waiting.map((row) => ({
            productId: row.product_id,
            quantity: Number(row.cases),
            name: row.product_name,
            cbm: row.cbm,
            grossWeightKg: row.gross_weight_kg,
          })),
        })

        if (!active) return

        setShipping(shippingPrice)
        setContainers(containerPlan)
        setContainerCode(containerPlan.plan?.[0]?.code || '')

        setItems((current) => [
          ...current
            .filter((item) => !item.carried_from_item_id)
            .map((item) => {
              const price = prices[item.product_id]
              if (!price) return item

              return {
                ...item,
                unit_price: price.price,
                price_source: price.source,
                moq: price.moq,
              }
            }),
          ...waiting.map((row) => ({
            id: `carried:${row.item_id}`,
            product_id: row.product_id,
            product_name: row.product_name,
            brand: null,
            quantity: Number(row.cases),
            notes: null,
            unit: row.unit,
            supplier_id: null,
            unit_price: 0,
            price_source: `Already paid on ${row.order_number}`,
            moq: null,
            carried_from_item_id: row.item_id,
            carried_from: row.order_number,
            // The last day this next order can be approved to take them (041).
            approve_by: row.deadline ? String(row.deadline).slice(0, 10) : null,
            // Under the product's name on the PFI.
            description: `From ${row.order_number} (rush shipment): already paid`,
          })),
        ])
      } catch (error) {
        console.error('Failed to load prices:', error)
        if (active) setPricingError(pricingErrorMessage(error))
      } finally {
        if (active) setLoadingPrices(false)
      }
    }

    loadPrices()

    return () => {
      active = false
    }
  }, [request])

  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * Number(item.unit_price || 0),
    0
  )

  // The containers it goes in (044): one when it fits, else full 40-ft high
  // cubes and the smallest size for the rest. `container` is the biggest one.
  const plan = containers?.plan || null
  const container = plan?.[0] || null
  const containerCount = containers?.count || 0
  const containerCost = plan && plan.every((entry) => entry.cost != null)
    ? plan.reduce((total, entry) => total + Number(entry.cost) * entry.count, 0)
    : null
  // Every container pays the destination's shipping (DMC's rule).
  const shippingCost = shipping.cost == null ? null : Number(shipping.cost) * Math.max(containerCount, 1)
  const planVolume = plan ? plan.reduce((total, entry) => total + entry.usableVolume * entry.count, 0) : 0
  const planWeight = plan ? plan.reduce((total, entry) => total + entry.maxWeight * entry.count, 0) : 0
  const noCost = plan?.find((entry) => entry.cost == null) || null
  const firstSize = containers?.options[0] || null
  const largestSize = containers?.options.at(-1) || null

  // Why no container can be chosen yet, if so.
  let containerProblem = ''

  if (containers?.load.unmeasured.length > 0) {
    containerProblem = `No volume or weight per case yet for ${containers.load.unmeasured.join(', ')} — admin must add it in the Product Catalog`
  } else if (containers?.tooBig) {
    containerProblem = `Too big for the largest container (${largestSize.name}: ${formatVolume(largestSize.usableVolume)}, ${formatWeight(largestSize.maxWeight)}) — ask the customer to reduce the quantity`
  } else if (containers && containers.options.length === 0) {
    containerProblem = 'No container sizes are set up — admin or management must add them in Markups & Credit'
  } else if (noCost) {
    containerProblem = `No cost for the ${noCost.name} container yet — admin or management must set it in Markups & Credit`
  }

  const total = subtotal + Number(containerCost || 0) + Number(shippingCost || 0)
  const downPayment = Math.round(total * 50) / 100

  // Sending these prices would take the customer over the credit limit if they
  // approved: it can't be sent, only put on hold until they pay (040). Priced
  // from the current price list each time, so a hold is never out of date.
  const priced = !loadingPrices && !pricingError && container && containerCost != null && shipping.cost != null
  const overBy = priced ? overLimitBy(credit, total) : 0
  const room = creditRoom(credit)
  const company = request.profiles?.company || 'The customer'


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">


        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              Generate Quotation
            </h2>

            <p className=" text-sm text-gray-500">
              Create a quotation from a quotation request.
            </p>
          </div>

          <button onClick={onClose} disabled={creating} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>



        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="flex-1 overflow-y-auto p-6">

          {overBy > 0 && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">Over the credit limit: these prices can't be sent yet.</p>
              <p className="mt-1">
                This quotation ({formatPeso(total)}) would take {company} over their credit limit if they approved it:
                they owe {formatPeso(credit.outstanding)} of {formatPeso(credit.creditLimit)}, so their room is {formatPeso(room)}.
                They have to pay first.
              </p>
              <p className="mt-1">
                {request.credit_hold_at
                  ? `On hold since ${formatDateTime(request.credit_hold_at)}${request.credit_hold_by_name ? ` (${request.credit_hold_by_name})` : ''}. You'll be told when their balance goes down.`
                  : 'Put it on hold: the customer is told to pay their open orders, without seeing any prices, and you\'re told when their balance goes down.'}
                {' '}Nothing is fixed while it's on hold: it's priced from the current price list each time it's opened.
              </p>
            </div>
          )}

          {overBy === 0 && priced && request.credit_hold_at && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              On hold since {formatDateTime(request.credit_hold_at)}: their balance now leaves room for it ({formatPeso(room)}), at today's prices. It can be sent.
            </div>
          )}



          {/* =================================================
              SELECTED CUSTOMER INFORMATION
          ================================================= */}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">
              Quotation Request Information
            </h3>

            <span className="text-xs text-gray-500">
              {items.length} item
              {items.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Reference </p>
              <p className="mt-1 font-medium text-gray-800"> {request.quotation_reference} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Company </p>
              <p className="mt-1 font-medium text-gray-800"> {request.profiles.company} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Preferred Ship Date </p>
              <p className="mt-1 font-medium text-gray-800"> {request.preferred_ship_date} </p>
            </div>

            <div>
              <p className=" text-xs uppercase text-gray-500"> Delivery Location </p>
              <p className="mt-1 font-medium text-gray-800"> {request.delivery_locations.location_name} </p>
            </div>
          </div>

          {shipEstimate?.estimatedShipDate && (
            <ShipEstimateCheck estimate={shipEstimate} preferredDate={request.preferred_ship_date} />
          )}


          {/* =================================================
              ITEMS
          ================================================= */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">
                  Customer Order Items
                </h3>

                <span className="text-xs text-gray-500">
                  {items.length} item
                  {items.length !== 1 ? 's' : ''}
                </span>
              </div>

              {carriedItems.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This customer agreed to a rush shipment on {[...new Set(carriedItems.map((item) => item.carried_from))].join(', ')}:
                  the goods that hadn't arrived then go in the container of their next order. They're added below at ₱0 (already paid),
                  counted in the container, and can't be left out.
                  {request.quotation_request_items.length === 0 && ' This request is for them alone: only its container and shipping are priced, and the customer pays them.'}
                  {approveBy && (
                    <span className="mt-1 block font-semibold">
                      The customer must approve this quotation by {formatDay(approveBy)}, or the waiting goods become DMC's. Price it promptly.
                    </span>
                  )}
                </div>
              )}

              {pricingError && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">
                    {pricingError} Quotations can't be generated until this is fixed.
                  </p>
                </div>
              )}

              <TableScroll className="rounded-lg border">
                <table className="min-w-full">

                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Product
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Notes
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Quantity
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Unit
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Unit Price
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                        Subtotal
                      </th>
                    </tr>
                  </thead>


                  <tbody>
                    {items.length > 0 ? (
                      items.map(
                        (item) => {
                          return (
                            <tr key={item.id} className="border-t border-gray-200">

                              {/* PRODUCT */}
                              <td className="px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.product_name}
                                </p>

                                {item.brand && (
                                  <p className="text-xs text-gray-500">
                                    {item.brand}
                                  </p>
                                )}

                                {item.carried_from && (
                                  <p className="mt-0.5 text-xs font-medium text-amber-700">
                                    From {item.carried_from} (rush shipment)
                                  </p>
                                )}
                              </td>


                              {/* NOTES */}
                              <td className=" px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.notes || '-'}
                                </p>
                              </td>


                              {/* QUANTITY */}
                              <td className=" px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.quantity}
                                </p>
                              </td>


                              {/* UNIT */}
                              <td className=" px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.unit || '-'}
                                </p>
                              </td>


                              {/* UNIT PRICE */}
                              <td className="px-4 py-4">
                                {/* Read-only: the price comes from the price list and markup. */}
                                <p className="font-medium text-gray-800">
                                  {loadingPrices
                                    ? 'Loading...'
                                    : item.unit_price != null
                                      ? `₱${item.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                                      : '-'}
                                </p>

                                {item.price_source && (
                                  <p className={`mt-1 max-w-[220px] text-xs ${item.unit_price != null ? 'text-gray-500' : 'font-medium text-red-700'}`}>
                                    {item.price_source}
                                  </p>
                                )}

                                {!item.carried_from_item_id && item.moq && item.quantity < item.moq && (
                                  <p className="mt-1 text-xs font-medium text-amber-700">
                                    Below supplier minimum of {item.moq} {item.unit}
                                  </p>
                                )}
                              </td>


                              {/* SUBTOTAL */}
                              <td className="px-4 py-4 text-right font-medium text-gray-800">
                               {item.unit_price != null ? `₱${(item.quantity * item.unit_price).toLocaleString()}` : '-'}
                              </td>
                            </tr>
                          )
                        }
                      )
                    ) : (
                      <tr>
                        <td colSpan="6" className=" py-10 text-center text-sm text-gray-500">
                          No products in this customer order.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </TableScroll>


              {/* =================================================
                  TOTAL
              ================================================= */}
              <div className="mt-6 flex justify-end">
                <div className="w-full max-w-sm">

                  <h3 className="mb-4 text-sm font-semibold text-gray-800">
                    Quotation Summary
                  </h3>

                  <div className="rounded-lg bg-gray-50 p-5">
                    {/* The smallest container that holds the order, chosen by the system. */}
                    <div className="mb-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-700">
                          Container
                        </span>

                        {loadingPrices ? (
                          <span className="font-medium text-gray-800">Loading...</span>
                        ) : plan ? (
                          <span className="text-right font-medium text-gray-800" title="Chosen by the system from each product's volume and weight per case">
                            {plan.map((entry) => (plan.length > 1 || entry.count > 1 ? `${entry.count} × ${entry.name}` : entry.name)).join(' + ')}
                          </span>
                        ) : (
                          <span className="font-medium text-gray-800">-</span>
                        )}
                      </div>

                      {containers && containers.load.unmeasured.length === 0 && (
                        <p className="mt-1 text-right text-xs text-gray-500">
                          Load: {formatVolume(containers.load.volume)}
                          {plan ? ` of ${formatVolume(planVolume)}` : ''}, {formatWeight(containers.load.weight)}
                          {plan ? ` of ${formatWeight(planWeight)}` : ''}
                        </p>
                      )}

                      {plan && containers.multiple && (
                        <p className="mt-1 text-right text-xs font-medium text-amber-700">
                          Too big for one {largestSize.name}: it takes {containerCount} containers, and each pays its own cost and shipping.
                        </p>
                      )}

                      {plan && !containers.multiple && firstSize && container.code !== firstSize.code && (
                        <p className="mt-1 text-right text-xs font-medium text-amber-700">
                          Too big for a {firstSize.name}, so it goes in a {container.name}.
                        </p>
                      )}

                      {containerProblem && (
                        <p className="mt-1 text-right text-xs font-medium text-red-700">
                          {containerProblem}
                        </p>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-medium text-gray-700">
                          Container Cost
                        </span>

                        <span className="font-medium text-gray-800">
                          {loadingPrices
                            ? 'Loading...'
                            : containerCost != null
                              ? `₱${containerCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                              : '-'}
                        </span>
                      </div>

                      {plan && containerCost != null && (
                        <p className="mt-1 text-right text-xs text-gray-500">
                          {containers.multiple
                            ? `Fixed costs: ${plan.map((entry) => `₱${Number(entry.cost).toLocaleString()}${entry.count > 1 ? ` × ${entry.count}` : ''}`).join(' + ')}`
                            : `Fixed cost of a ${container.name}`}
                        </p>
                      )}
                    </div>


                    {/* Read-only: the country's fixed shipping cost. */}
                    <div className="mb-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">
                          Shipping Cost
                        </span>

                        <span className="font-medium text-gray-800">
                          {loadingPrices
                            ? 'Loading...'
                            : shippingCost != null
                              ? `₱${shippingCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                              : '-'}
                        </span>
                      </div>

                      {shipping.cost != null && containerCount > 1 && (
                        <p className="mt-1 text-right text-xs text-gray-500">
                          ₱{Number(shipping.cost).toLocaleString()} × {containerCount} containers
                        </p>
                      )}

                      {shipping.source && (
                        <p className={`mt-1 text-right text-xs ${shipping.cost != null ? 'text-gray-500' : 'font-medium text-red-700'}`}>
                          {shipping.source}
                        </p>
                      )}
                    </div>


                    {/* Read-only: fixed by DMC's 7-day rule. */}
                    <div className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">
                          Expiry Date
                        </span>

                        <span className="font-medium text-gray-800">
                          {formatDateString(expiryDate)}
                        </span>
                      </div>

                      <p className="mt-1 text-right text-xs text-gray-500">
                        Fixed: {QUOTATION_VALIDITY_DAYS} days from today, Sundays not counted
                      </p>
                    </div>

                    <div className="my-4 border-t border-gray-200" />

                    <div className="mb-2 flex justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Subtotal
                      </span>

                      <span className="font-semibold text-gray-800">
                        ₱{subtotal.toLocaleString()}
                      </span>
                    </div>

                    <div className="mb-2 flex justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Container
                      </span>

                      <span className="font-semibold text-gray-800">
                        ₱{Number(containerCost || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="mb-3 flex justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Shipping
                      </span>

                      <span className="font-semibold text-gray-800">
                        ₱{Number(shippingCost || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-800">
                          Total
                        </span>

                        <span className="text-lg font-bold text-gray-800">
                          ₱{total.toLocaleString()}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-semibold text-[#1F3A2C]">
                          50% Down Payment
                        </span>

                        <span className="text-lg font-bold text-[#1F3A2C]">
                          ₱{downPayment.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="my-4 border-t border-gray-200" />


                    <div className="flex justify-end gap-3">
                      <button onClick={onClose} disabled={creating} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" >
                        Cancel
                      </button>

                      {overBy > 0 ? (
                        <button
                          disabled={creating || Boolean(request.credit_hold_at)}
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Put ${request.quotation_reference} on hold until ${company} pays?\n\n` +
                              'They are told to pay their open orders first, without seeing any prices.'
                            )
                            if (confirmed) onHold(request)
                          }}
                          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {request.credit_hold_at ? 'On Hold Until They Pay' : 'Put on Hold Until They Pay'}
                        </button>
                      ) : (
                      <button
                        disabled={creating || loadingPrices}
                        onClick={() => {
                          // Every line needs its fixed price; there is no
                          // manual price to fall back on.
                          const unpriced = items.find(
                            (item) => !item.carried_from_item_id && !(Number(item.unit_price) > 0)
                          )

                          // Something to quote: the customer's products, or their
                          // waiting goods alone when the request has none (039).
                          if (!items.length) {
                            alert("Nothing to quote: this request has no products, and the customer's waiting goods already go with another order.")
                            return
                          }

                          if (request.quotation_request_items.length > 0 && !items.some((item) => !item.carried_from_item_id)) {
                            alert('This quotation has only goods waiting from a rush shipment, but the customer asked for products too.')
                            return
                          }

                          if (unpriced) {
                            alert(`${unpriced.product_name} can't be priced yet: ${unpriced.price_source || 'prices could not be loaded'}.`)
                            return
                          }

                          if (!container || containerCost == null) {
                            alert(`The container can't be worked out yet: ${containerProblem || 'container sizes could not be loaded'}.`)
                            return
                          }

                          if (shipping.cost == null) {
                            alert(`Shipping can't be worked out yet: ${shipping.source || 'rates could not be loaded'}.`)
                            return
                          }

                          const confirmed = window.confirm(
                            'Are you sure you want to generate this quotation?\n\n' +
                            'Once generated, the customer will be able to view and respond to the quotation.'
                          )

                          if (!confirmed) return

                          onSubmit({
                            items,
                            containerSize: container.code,
                            containerPlan: plan.map((entry) => ({ code: entry.code, count: entry.count })),
                            containerCost,
                            shippingCost,
                            expiryDate,
                            subtotal,
                            total,
                            downPayment,
                          })
                        }}
                        className="rounded-md bg-[#1F3A2C] px-4 py-2 text-sm font-medium text-white hover:bg-[#2D5A42] disabled:opacity-50"
                      >
                        <FontAwesomeIcon icon={faFileInvoice} />
                        {creating ? ' Generating Quotation...': ' Generate Quotation'}
                      </button>
                      )}
                    </div>
                  </div>

                </div>
              </div>

            </div>
        </div>
      </div>
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per quotation request, as listed.
// =============================================
const requestColumns = (requests) => [
  { header: 'Reference', value: (request) => request.quotation_reference },
  { header: 'New quote for', value: (request) => requests.find((other) => other.id === request.replaces_request_id)?.quotation_reference || '' },
  { header: 'Company', value: (request) => request.profiles?.company },
  { header: 'Email', value: (request) => request.profiles?.email },
  { header: 'Delivery location', value: (request) => request.delivery_locations?.location_name },
  { header: 'Country', value: (request) => request.delivery_locations?.country },
  { header: 'Status', value: (request) => statusText(request.status) },
  { header: 'Requested', value: (request) => dateTime(request.created_at) },
  { header: 'Preferred ship date', value: (request) => day(request.preferred_ship_date) },
  { header: 'Products', value: (request) => productsText(request.quotation_request_items) },
]
