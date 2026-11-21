'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faFileSignature, faDownload, faXmark, faChevronDown, faLocationDot } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"
import { MIN_PREFERRED_SHIP_DAYS, localDateString, formatDateTime } from '../utils/dates'
import { getCreditStatus, formatPeso } from '../services/creditService'
import { getMinimumOrderQuantities } from '../services/pricingService'
import { groupByFamily, sizeLabel } from '../utils/productGroups'
import { previewMyEstimate } from '../services/predictionService'
import { loadCarriedFrom } from '../services/rushService'
import { RUSH_ITEM_COLUMNS, columnsIf, isMissingColumn, withNewColumns } from '../utils/newColumns'
import { ACCOUNT_COLUMNS, newOrdersStopped } from '../utils/customerAccount'

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'
import TableScroll from '../components/TableScroll'
import ListControls from '../components/ListControls'
import { dateTime, exportList, productsText, statusText } from '../utils/csvExport'
import { ALL, applySearch, applyShow, applySort, byNewest, byOldest, byStatus, showChoices, showingOf, statusLabel } from '../utils/listControls'


export default function QuotationRequestsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()
  
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [products, setProducts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [requests, setRequests] = useState([])
  // Show (a request status), Sort by and Search, above the list.
  const [show, setShow] = useState(ALL)
  const [sortBy, setSortBy] = useState('status')
  const [search, setSearch] = useState('')
  const [showQuotationModal, setShowQuotationModal] = useState(false)
  const [selectedQuotation, setSelectedQuotation] = useState(null)
  const [loadingQuotation, setLoadingQuotation] = useState(false)
  const [creatingCO, setCreatingCO] = useState(false)
  const [credit, setCredit] = useState(null)
  // The expired request a new quote is being asked for in place of (035).
  const [requestAgain, setRequestAgain] = useState(null)
  // Changing a request's delivery location (037): the request, and each
  // request's changes so far.
  const [movingRequest, setMovingRequest] = useState(null)
  const [locationChanges, setLocationChanges] = useState({})
  // DMC stopped this customer's new orders (038): no new requests, approvals
  // or new quotes. Read again on load: admin may have done it since sign-in.
  const [stopped, setStopped] = useState(() => newOrdersStopped(profile))


  // =============================================
  // WHETHER NEW ORDERS ARE STOPPED (db/migrations/038)
  // =============================================
  async function loadAccount() {
    const { data, error } = await supabase
      .from('profiles')
      .select(`is_active, ${ACCOUNT_COLUMNS.join(', ')}`)
      .eq('id', profile.id)
      .maybeSingle()
    if (!error && data) setStopped(newOrdersStopped(data))
  }


  // =============================================
  // LOAD CREDIT STATUS
  //
  // Once the unpaid balance reaches DMC's credit limit, new requests and
  // quotation approvals are blocked until the customer pays.
  // =============================================
  async function loadCredit() {
    try {
      const status = await getCreditStatus(profile.id)
      setCredit(status)
      return status
    } catch (error) {
      // Not set up yet, or offline: the database still enforces the limit.
      console.error('Failed to load credit status:', error)
      setCredit(null)
      return null
    }
  }


  // =============================================
  // LOAD REQUESTS
  // =============================================
  async function loadRequests() {
    // Which request a new quote replaces (035), asked for until that script is run.
    const { data, error } = await withNewColumns((withLink) => supabase
      .from('quotation_requests')
      .select(`
        id,
        quotation_reference,
        status,
        created_at,
        delivery_location_id,
        ${columnsIf(withLink, ['replaces_request_id'])}
        delivery_locations (
          location_name,
          address,
          country
        ),
        quotation_request_items (
          id,
          product_id,
          quantity,
          notes,
          products (
            product_name,
            brand,
            unit
          )
        )
      `)
      .eq('customer_id', profile.id)
      .order('created_at', { ascending: false }), ['replaces_request_id'])

    if (error) {
      toast.error(error.message)
      return
    }

    setRequests(data || [])
    loadLocationChanges()
  }


  // Each request's delivery location changes, newest last (037; none before it's run).
  async function loadLocationChanges() {
    const { data, error } = await supabase
      .from('quotation_request_location_changes')
      .select('quotation_request_id, from_text, to_text, withdrawn_quotation_id, changed_at')
      .order('changed_at', { ascending: true })
    if (error) return
    const byRequest = {}
    for (const change of data || []) (byRequest[change.quotation_request_id] ||= []).push(change)
    setLocationChanges(byRequest)
  }


  // =============================================
  // LOAD DELIVERY LOCATIONS
  // =============================================
  async function loadDeliveryLocations() {
    const { data, error } = await supabase
      .from('delivery_locations')
      .select('*')
      .eq('profile_id', profile.id)
      .eq('is_archived', false)
      .order('location_name')

    if (error) {
      toast.error(error.message)
      return
    }

    setDeliveryLocations(data || [])
  }


  // =============================================
  // LOAD PRODUCTS
  // =============================================
  async function loadProducts() {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_name, brand, unit, availability, family, pack_size')
      .order('product_name')

    if (error) {
      toast.error(error.message)
      return
    }

    setProducts(data || [])
  }
  

  // =============================================
  // SAVE REQUEST
  // =============================================
  async function saveRequest(formData) {
    const quotationReference = generateQuotationReference()

    // A new quote for an expired one says which request it replaces (035).
    const row = {
      quotation_reference: quotationReference,
      customer_id: profile.id,
      delivery_location_id: formData.delivery_location_id,
      preferred_ship_date: formData.preferred_ship_date,
      status: 'awaiting pricing',
      ...(formData.replaces_request_id ? { replaces_request_id: formData.replaces_request_id } : {}),
    }
    const insertRequest = (values) => supabase.from('quotation_requests').insert(values).select().single()

    let { data: request, error } = await insertRequest(row)

    // Before 035 is run, it's saved as an ordinary request.
    if (error && row.replaces_request_id && (error.code === 'PGRST204' || isMissingColumn(error, ['replaces_request_id']))) {
      const withoutLink = { ...row }
      delete withoutLink.replaces_request_id
      ;({ data: request, error } = await insertRequest(withoutLink))
    }

    if (error) {
      toast.error(error.message)
      return
    }

    const items = formData.items.map((item) => ({
      quotation_request_id: request.id,
      product_id: item.product_id,
      quantity: item.quantity,
      notes: item.notes,
    }))

    const { error: itemError } = await supabase
      .from('quotation_request_items')
      .insert(items)

    if (itemError) {
      // The request was saved but its products weren't (e.g. one is below
      // its minimum order), so remove it rather than leave an empty request.
      await supabase.from('quotation_requests').delete().eq('id', request.id)
      toast.error(itemError.message || 'Failed to save the requested products.')
      return
    }

    if (formData.replaces_request_id) {
      toast.success(`New quote requested: ${quotationReference}. DMC prices it again with today's prices.`)
    }

    setShowModal(false)
    setRequestAgain(null)
    loadRequests()
  }


  // A new quote in place of an expired one: the request form, filled in from it.
  function requestNewQuote(quotation) {
    const expired = requests.find((request) => request.id === quotation?.quotation_request_id)
    if (!expired) {
      toast.error('The request of this quotation could not be found. Please reload the page.')
      return
    }

    setShowQuotationModal(false)
    setSelectedQuotation(null)
    setRequestAgain(expired)
    setShowModal(true)
  }

  // The request asked for in place of this one, if any.
  const replacementOf = (requestId) => requests.find((request) => request.replaces_request_id === requestId) || null


  // =============================================
  // DELETE REQUEST
  // =============================================
  async function deleteRequest(requestId) {
    const confirmed = window.confirm(
      'Are you sure you want to delete this quotation request?'
    )

    if (!confirmed) return

    // One step in the database (037): deleted, or kept and marked cancelled if a
    // quotation of it is on record (one withdrawn when its location changed).
    const { data: outcome, error: cancelError } = await supabase.rpc('cancel_quotation_request', { p_request_id: requestId })
    if (!cancelError) {
      toast.success(outcome === 'cancelled' ? 'Quotation request cancelled. It stays on record with its earlier quotation.' : 'Quotation request deleted successfully')
      loadRequests()
      return
    }
    if (cancelError.code !== 'PGRST202' && !/cancel_quotation_request/.test(cancelError.message || '')) {
      toast.error(cancelError.message || 'The request could not be cancelled.')
      return
    }

    // Before 037 is run: as before. Delete child records first
    const { error: itemError } = await supabase
      .from('quotation_request_items')
      .delete()
      .eq('quotation_request_id', requestId)

    if (itemError) {
      toast.error(itemError)
      return
    }

    // Delete the quotation request
    const { error } = await supabase
      .from('quotation_requests')
      .delete()
      .eq('id', requestId)

    if (error) {
      toast.error(error)
      return
    }

    toast.success('Quotation request deleted successfully')
    loadRequests()
  }


  // =============================================
  // GENERATE QUOTATION REFERENCE
  // =============================================
  function generateQuotationReference() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let random = ''

    for (let i = 0; i < 6; i++) {
      random += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    return `REF-${random}`
  }


  // =============================================
  // OPEN QUOTATION MODAL
  // =============================================
  async function viewQuotation(requestId) {
    setLoadingQuotation(true)

    // Lines for goods waiting from a rush shipment (034) are asked for until then.
    const { data, error } = await withNewColumns((withRush) => supabase
      .from('quotations')
      .select(`
        id,
        quotation_request_id,
        quotation_number,
        subtotal,
        container_size,
        container_cost,
        shipping_cost,
        total_amount,
        down_payment_amount,
        expiry_date,
        status,
        created_at,
        pfi_file_path,

        quotation_request:quotation_requests (
          delivery_location_id,
          preferred_ship_date
        ),

        customer_orders (
          order_number,
          status
        ),

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
      .eq('quotation_request_id', requestId)
      // Its newest: an earlier one may have been withdrawn when the delivery
      // location changed (037).
      .order('created_at', { ascending: false })
      .limit(1)
      .single(), RUSH_ITEM_COLUMNS)

    if (error) {
      setLoadingQuotation(false)
      toast.error('Failed to load quotation.')
      return
    }

    const carriedFrom = await loadCarriedFrom(data.quotation_items)
    setLoadingQuotation(false)

    setSelectedQuotation({
      ...data,
      quotation_items: (data.quotation_items || []).map((item) => ({
        ...item,
        carried_from: item.carried_from_item_id ? carriedFrom.get(item.carried_from_item_id) || 'an earlier order' : null,
      })),
    })
    setShowQuotationModal(true)
  }


  // =============================================
  // REJECT QUOTATION
  // =============================================
  async function rejectQuotation(quotationId) {
    const confirmed = window.confirm(
      'Are you sure you want to reject this quotation?'
    )

    if (!confirmed) return

    // In one database step, so the quotation and its request can't disagree.
    const { error } = await supabase.rpc('reject_quotation', {
      p_quotation_id: quotationId,
    })

    if (error) {
      console.error(error)
      toast.error(error.message || 'Failed to reject quotation.')
      return
    }

    // Update modal state
    setSelectedQuotation((prev) => ({
      ...prev,
      status: 'rejected',
    }))

    toast.success('Quotation rejected successfully')
    await loadRequests()
  }


  // =============================================
  // APPROVE QUOTATION 
  // =============================================
  async function approveQuotation() {


    const quotation = selectedQuotation

    if (!quotation) return

    const today = new Date()
    const expiryDate = new Date(`${quotation.expiry_date}T23:59:59`)

    if (today > expiryDate) {
      alert(
        'This quotation has expired. Please request a refreshed quote before approving.'
      )
      return
    }

    // Approving creates an order, which a customer at their credit limit
    // can't place. Re-checked here in case they paid or ordered elsewhere.
    const creditStatus = await loadCredit()

    if (creditStatus?.blocked) {
      alert(
        `Your unpaid balance of ${formatPeso(creditStatus.outstanding)} has reached your credit limit of ${formatPeso(creditStatus.creditLimit)}. Please pay your open orders before approving this quotation.`
      )
      return
    }

    const confirmed = window.confirm(
      'Are you sure you want to approve this quotation?'
    )

    if (!confirmed) return

    setCreatingCO(true)


    try {

      // Creates the order from the quotation in one database step, which also
      // numbers it. The quotation and its request are kept, marked approved.
      const { data: orderNumber, error: approveError } = await supabase.rpc('approve_quotation', {
        p_quotation_id: quotation.id,
      })

      if (approveError) {
        console.error(approveError)
        // The database's own message, e.g. the credit-limit refusal.
        alert(approveError.message || 'Failed to approve the quotation.')
        return
      }

      toast.success(`Quotation approved. Your order number is ${orderNumber}.`)

      setShowQuotationModal(false)
      setSelectedQuotation(null)

      await loadRequests()
      await loadCredit()
    }
    
    catch (error) {
      console.error(error)
      alert('Something went wrong while approving the quotation.')
    }

    finally {
      setCreatingCO(false)
    }
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadRequests()
      loadDeliveryLocations()
      loadProducts()
      loadCredit()
      loadAccount()
    }
  }, [profile])


  // =============================================
  // MAIN CONTENT
  // =============================================
  // The list as chosen above it. A priced request is waiting for the customer.
  const REQUEST_ORDER = ['awaiting pricing', 'priced & sent to customer', 'approved', 'rejected', 'expired', 'cancelled']
  const requestList = {
    statusOf: (request) => request.status,
    order: REQUEST_ORDER,
    labelOf: (status) => (status === 'priced & sent to customer' ? 'Waiting for your answer' : statusLabel(status)),
    allLabel: 'All requests',
  }
  const choices = showChoices(requests, requestList)
  const showing = showingOf(choices, show)
  const shownRequests = applySort(
    applySearch(applyShow(requests, showing, requestList), search, (request) => [request.quotation_reference, ...(request.quotation_request_items || []).map((item) => item.products?.product_name)].join(' ')),
    sortBy,
    {
      status: byStatus((request) => request.status, REQUEST_ORDER, (request) => request.created_at),
      newest: byNewest((request) => request.created_at),
      oldest: byOldest((request) => request.created_at),
    }
  )

  return (
    <div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Quotation Requests
          </h1>

          <p className="mt-1 text-gray-500">
            View your submitted quotation requests.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          disabled={credit?.blocked || stopped}
          title={stopped ? 'DMC has stopped new orders on your account' : credit?.blocked ? 'Your unpaid balance has reached your credit limit' : undefined}
          className="flex items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faPlus}/>
          Create Quotation Request
        </button>
      </div>


      {/* New orders stopped by DMC (038) */}
      {stopped && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            DMC has stopped new orders on your account.
          </p>
          <p className="mt-1 text-sm text-amber-700">
            You can still pay what you owe and follow your current orders on My Orders. Please contact DMC about new orders.
          </p>
        </div>
      )}


      {/* Credit limit */}
      {credit?.blocked && !stopped && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Your unpaid balance of {formatPeso(credit.outstanding)} has reached your credit limit of {formatPeso(credit.creditLimit)}.
          </p>
          <p className="mt-1 text-sm text-red-700">
            You can't send new quotation requests or approve quotations until you pay your open orders on the Payments page.
          </p>
        </div>
      )}


      <ListControls
        choices={choices}
        show={showing}
        onShow={setShow}
        sorts={[
          { value: 'status', label: 'Status (awaiting pricing first, newest first in each)' },
          { value: 'newest', label: 'Newest first' },
          { value: 'oldest', label: 'Oldest first' },
        ]}
        sortBy={sortBy}
        onSort={setSortBy}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Reference or product"
        shown={shownRequests.length}
        total={requests.length}
        onExport={(how) => exportList(how, 'my-quotation-requests', myRequestColumns(requests), shownRequests)}
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
                Location
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Items
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
                        New quote for {requests.find((other) => other.id === request.replaces_request_id)?.quotation_reference || 'an expired request'}
                      </span>
                    )}
                    {replacementOf(request.id) && (
                      <span className="mt-0.5 block text-xs font-normal text-gray-500">
                        New quote requested: {replacementOf(request.id).quotation_reference}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    {request.delivery_locations?.location_name || '-'}
                    {locationChanges[request.id]?.length > 0 && (
                      <span className="mt-0.5 block max-w-[14rem] text-xs text-gray-500">
                        Changed {formatDateTime(locationChanges[request.id].at(-1).changed_at)}, from {locationChanges[request.id].at(-1).from_text}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    <div className="space-y-2">
                      {request.quotation_request_items?.length > 0 ? (
                        request.quotation_request_items.map((item) => (
                          <div key={item.id}>
                            <div className="font-medium">
                              {item.products?.product_name}
                              <span className="ml-2 text-sm font-normal text-gray-500">
                                × {item.quantity} {item.products?.unit}
                              </span>
                            </div>

                            {item.notes && (
                              <div className="text-xs italic text-gray-500">
                                {item.notes}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="text-gray-400">No items</span>
                      )}
                    </div>
                  </td>

                  <td className="px-5 py-3">
                    <StatusBadge status={request.status} />
                  </td>

                  <td className="px-5 py-3">
                    {formatDateTime(request.created_at)}
                  </td>

                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      {request.status === 'awaiting pricing' ? (
                        <IconButton icon={faTrash} title="Cancel Request" color="red" disabled={false} onClick={() => deleteRequest(request.id)}/>
                      ) : (
                        <IconButton icon={faFileSignature} title="View Quotation" color="blue" disabled={false} onClick={() => viewQuotation(request.id)}/>
                      )}
                      {['awaiting pricing', 'priced & sent to customer'].includes(request.status) && (
                        <IconButton icon={faLocationDot} title="Change delivery location" color="amber" disabled={false} onClick={() => setMovingRequest(request)}/>
                      )}
                    </div>
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

    {showModal && (
      <QuotationRequestModal
        deliveryLocations={deliveryLocations}
        products={products}
        initial={requestAgain && {
          delivery_location_id: requestAgain.delivery_location_id,
          items: (requestAgain.quotation_request_items || []).map((item) => ({ product_id: item.product_id, quantity: item.quantity, notes: item.notes || '' })),
          replaces: { id: requestAgain.id, reference: requestAgain.quotation_reference },
        }}
        onClose={() => {
          setShowModal(false)
          setRequestAgain(null)
        }}
        onSubmit={saveRequest}
      />
    )}

    {movingRequest && (
      <ChangeLocationModal
        request={movingRequest}
        locations={deliveryLocations}
        onClose={() => setMovingRequest(null)}
        onChanged={() => {
          setMovingRequest(null)
          loadRequests()
        }}
      />
    )}

    {showQuotationModal && (
      <QuotationModal
        quotation={selectedQuotation}
        loading={loadingQuotation}
        onApprove={approveQuotation}
        onReject={rejectQuotation}
        onRequestAgain={requestNewQuote}
        onChangeLocation={(quotation) => {
          const request = requests.find((entry) => entry.id === quotation.quotation_request_id)
          if (!request) return
          setShowQuotationModal(false)
          setSelectedQuotation(null)
          setMovingRequest(request)
        }}
        newQuote={selectedQuotation ? replacementOf(selectedQuotation.quotation_request_id)?.quotation_reference || null : null}
        blocked={Boolean(credit?.blocked) || stopped}
        blockedReason={stopped ? 'DMC has stopped new orders on your account' : undefined}
        creating={creatingCO}
        onClose={() => {
          if (creatingCO) { return }
          setShowQuotationModal(false)
          setSelectedQuotation(null)
        }}
      />
    )}

    </div>
  )
}



// =============================================
// QUOTATION MODAL
// =============================================
// =============================================
// SHIP DATE ESTIMATE NOTE
//
// When an order would likely ship, its likely range and arrival, and a warning
// when the preferred date is earlier. From DMC's server, as if paid today.
// =============================================
function ShipEstimateNote({ estimate, lead, preferredDate }) {
  const fullDate = (date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const shortDate = (date) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const tooEarly = Boolean(preferredDate) && estimate.daysPastRequested > 0

  return (
    <div className={`mb-6 rounded-lg border p-4 text-sm ${tooEarly ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
      <p className="font-medium text-gray-800">
        {lead} {fullDate(estimate.estimatedShipDate)}.
      </p>

      {estimate.shipDateRange && (
        <p className="mt-0.5 text-gray-600">
          Likely {shortDate(estimate.shipDateRange.quick)} to {shortDate(estimate.shipDateRange.slow)}
          {estimate.estimatedArrivalDate ? `, arriving at your port around ${fullDate(estimate.estimatedArrivalDate)}` : ''}.
        </p>
      )}

      {tooEarly && (
        <p className="mt-1 font-medium text-amber-800">
          Your preferred date ({fullDate(`${preferredDate}T00:00:00`)}) is earlier than that, so it may be hard to meet.
        </p>
      )}

      <p className="mt-1 text-xs text-gray-500">
        An estimate from past orders, not a guaranteed date.
      </p>
    </div>
  )
}


// The quotation's estimate, as if the customer approved and paid today.
function QuotationShipEstimate({ quotation }) {
  const [estimate, setEstimate] = useState(null)
  const preferredDate = quotation.quotation_request?.preferred_ship_date || null

  useEffect(() => {
    let active = true

    previewMyEstimate({
      items: (quotation.quotation_items || []).map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) || 0 })),
      deliveryLocationId: quotation.quotation_request?.delivery_location_id || null,
      requestedShipDate: preferredDate,
      containerSize: quotation.container_size || null,
    })
      .then((result) => { if (active) setEstimate(result) })
      .catch((error) => console.error('Failed to estimate the ship date:', error))

    return () => { active = false }
  }, [quotation.id])

  if (!estimate?.estimatedShipDate) return null

  return (
    <ShipEstimateNote
      estimate={estimate}
      lead="If you approve and pay the down payment today, it ships around"
      preferredDate={preferredDate}
    />
  )
}


function QuotationModal({ quotation, loading, creating, onClose, onApprove, onReject, onRequestAgain, onChangeLocation, newQuote = null, blocked = false, blockedReason = 'Your unpaid balance has reached your credit limit' }) {
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="rounded-xl bg-white p-8">
          Loading quotation...
        </div>
      </div>
    )
  }

  if (!quotation) return null

  const today = new Date()
  // Marked expired by the system (035), or past its expiry date before that run.
  const isExpired = quotation.status === 'expired' || today > new Date(`${quotation.expiry_date}T23:59:59`)

  const expiryDate = new Date(quotation.expiry_date)

  today.setHours(0, 0, 0, 0)
  expiryDate.setHours(0, 0, 0, 0)

  const daysUntilExpiry = Math.ceil(
    (expiryDate - today) / (1000 * 60 * 60 * 24)
  )

  const isExpiringSoon = daysUntilExpiry <= 3

  const order = Array.isArray(quotation.customer_orders) ? quotation.customer_orders[0] : quotation.customer_orders


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
            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500"> Quotation Number </p>
              <p className="mt-1 font-medium text-gray-800"> {quotation.quotation_number || '-'} </p>
            </div>

            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <p className="mt-1 font-medium text-gray-800"> <StatusBadge status={quotation.status}/> </p>
            </div>

            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500"> Date Created </p>
              <p className="mt-1 font-medium text-gray-800"> {formatDateTime(quotation.created_at)} </p>
            </div>

            <div className={`flex flex-col justify-center rounded-md border p-2 ${isExpiringSoon ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className={`text-xs font-semibold uppercase ${isExpiringSoon ? 'text-red-600' : 'text-amber-600'}`}> Expiry Date </p>
              <p className={`mt-1 font-semibold ${ isExpiringSoon ? 'text-red-800' : 'text-amber-800' }`}> {new Date(quotation.expiry_date).toLocaleDateString()} </p>
            </div>
          </div>

          {(quotation.status || '').trim().toLowerCase() === 'pending approval' && !isExpired && (
            <QuotationShipEstimate quotation={quotation} />
          )}


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
                          From {item.carried_from} (your rush shipment): already paid, goes in this order's container
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
                      Container ({quotation.container_size})
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
        <div className="flex w-full items-center gap-3 bg-gray-50 px-6 py-4">
          {['rejected', 'approved', 'cancelled', 'withdrawn'].includes(quotation.status) ? (
            <div className="flex w-full items-center justify-between gap-4">
              <div>
                <p className={`font-medium ${quotation.status === 'approved' ? 'text-green-600' : 'text-red-600'}`}>
                  Quotation {quotation.status === 'approved' ? 'Approved' : quotation.status === 'rejected' ? 'Rejected' : quotation.status === 'withdrawn' ? 'Withdrawn' : 'Cancelled'}
                </p>

                <p className="text-sm text-gray-500">
                  {quotation.status === 'approved' && `This quotation was approved${order?.order_number ? ` and became order ${order.order_number}` : ''}.`}
                  {quotation.status === 'rejected' && 'This quotation was rejected.'}
                  {quotation.status === 'withdrawn' && "You changed the request's delivery location, so DMC is pricing it again."}
                  {quotation.status === 'cancelled' && (
                    order?.order_number
                      ? `The order made from this quotation, ${order.order_number}, was cancelled: its down payment wasn't received in time.`
                      : 'The order made from this quotation was deleted.'
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={downloadPFI}
                  disabled={!quotation?.pfi_file_path || creating}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FontAwesomeIcon icon={faDownload} />
                  Download PFI
                </button>

                <button
                  onClick={onClose}
                  disabled={creating}
                  className="rounded-lg bg-gray-200 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          ) : isExpired ? (
            <div className="flex w-full items-center justify-between gap-4">
              <div>
                <p className="font-medium text-red-600">
                  Quotation Expired
                </p>

                <p className="text-sm text-gray-500">
                  It expired on {new Date(`${quotation.expiry_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} without being approved, so it can't be approved any more.
                  {newQuote
                    ? ` You asked for a new quote: ${newQuote}.`
                    : ' Ask for a new quote: your products are filled in for you, and DMC prices them again.'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {!newQuote && onRequestAgain && (
                  <button
                    type="button"
                    onClick={() => onRequestAgain(quotation)}
                    disabled={creating || blocked}
                    title={blocked ? blockedReason : undefined}
                    className="rounded-lg bg-[#2D5A42] px-5 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
                  >
                    Request a new quote
                  </button>
                )}

                <button
                  onClick={onClose}
                  disabled={creating}
                  className="rounded-lg bg-gray-200 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={downloadPFI}
                disabled={!quotation?.pfi_file_path || creating}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faDownload} />
                Download PFI
              </button>

              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  disabled={creating}
                  className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Close
                </button>

                {onChangeLocation && (
                  <button
                    type="button"
                    onClick={() => onChangeLocation(quotation)}
                    disabled={creating}
                    className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Change Delivery Location
                  </button>
                )}

                <button
                  onClick={() => onReject(quotation.id)}
                  disabled={creating}
                  className="rounded-lg border border-red-600 bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject Quotation
                </button>

                <button
                  onClick={() => onApprove(quotation.id)}
                  disabled={creating}
                  className="rounded-lg bg-[#2D5A42] px-5 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
                >
                  {creating ? 'Creating Your Order...': 'Approve Quotation'}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}



// =============================================
// QUOTATION REQUEST MODAL
// =============================================
// initial: a new quote for an expired request (035): its delivery location
// and products, filled in, and which request it replaces.
function QuotationRequestModal({ deliveryLocations, products, initial = null, onClose, onSubmit }) {
  const { toast } = useToast()
  const [selectedProducts, setSelectedProducts] = useState(initial?.items || [])
  const [minimums, setMinimums] = useState({})
  const [productSearch, setProductSearch] = useState('')

  const [form, setForm] = useState({
    preferred_ship_date: '',
    // Only a location still in use.
    delivery_location_id: deliveryLocations.some((location) => location.id === initial?.delivery_location_id) ? initial.delivery_location_id : '',
  })

  const earliestShipDate = localDateString(MIN_PREFERRED_SHIP_DAYS)

  // Each product's minimum order (its supplier's MOQ); no entry = no minimum.
  const minimumFor = (productId) => minimums[productId] || 1

  // An unavailable product can't go into a new request. Requests and orders
  // already in progress aren't affected (the database checks new lines only).
  const isUnavailable = (product) => (product?.availability || '').toLowerCase() === 'unavailable'

  // The catalog is large, so the list is searchable, and each product's
  // sizes are grouped under it. Ticked sizes stay ticked while searching.
  const searchTerm = productSearch.trim().toLowerCase()
  const visibleGroups = groupByFamily(
    searchTerm
      ? products.filter((product) =>
          [product.product_name, product.family, product.brand]
            .some((value) => (value || '').toLowerCase().includes(searchTerm))
        )
      : products
  )

  useEffect(() => {
    getMinimumOrderQuantities()
      .then(setMinimums)
      .catch((error) => console.error('Failed to load minimum order quantities:', error))
  }, [])


  // When an order like this would likely ship, if the down payment were made
  // today, from DMC's server. Waits until typing stops, and keeps only the
  // latest answer.
  const [shipEstimate, setShipEstimate] = useState(null)

  useEffect(() => {
    if (!selectedProducts.length) {
      setShipEstimate(null)
      return
    }

    let active = true
    const timer = setTimeout(() => {
      previewMyEstimate({
        items: selectedProducts.map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) || 0 })),
        deliveryLocationId: form.delivery_location_id || null,
        requestedShipDate: form.preferred_ship_date || null,
      })
        .then((estimate) => { if (active) setShipEstimate(estimate) })
        .catch((error) => {
          console.error('Failed to estimate the ship date:', error)
          if (active) setShipEstimate(null)
        })
    }, 600)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [selectedProducts, form.delivery_location_id, form.preferred_ship_date])


  // Ticking a size adds it at the minimum the customer may order. Unticking it,
  // or removing it from the selected list, takes it out.
  function setPicked(product, picked) {
    if (picked) {
      setSelectedProducts([
        ...selectedProducts,
        { product_id: product.id, quantity: minimumFor(product.id), notes: '' },
      ])
    } else {
      setSelectedProducts(selectedProducts.filter((p) => p.product_id !== product.id))
    }
  }

  function updatePicked(productId, changes) {
    setSelectedProducts(
      selectedProducts.map((p) => (p.product_id === productId ? { ...p, ...changes } : p))
    )
  }

  // Selected Products can be collapsed. It opens again to show the picks, and
  // before submitting, so the browser can point at a quantity that needs fixing.
  function openSelected() {
    const section = document.getElementById('selected-products')
    if (section) section.open = true
    return section
  }


  function handleSubmit(e) {
    e.preventDefault()

    if (
      !form.delivery_location_id ||
      !form.preferred_ship_date ||
      selectedProducts.length === 0
    ) {
      return
    }

    // The date picker's min only limits clicking; a typed date bypasses it.
    if (form.preferred_ship_date < earliestShipDate) {
      toast.error(`Preferred shipping date must be at least ${MIN_PREFERRED_SHIP_DAYS} days from today (${earliestShipDate} or later).`)
      return
    }

    const invalidQuantity = selectedProducts.some(
      (item) => !Number.isInteger(item.quantity) || item.quantity < 1
    )

    if (invalidQuantity) {
      toast.error('Each selected product needs a whole-number quantity of at least 1.')
      return
    }

    // Also checked by the database when the request is saved.
    const unavailable = selectedProducts
      .map((item) => products.find((p) => p.id === item.product_id))
      .find(isUnavailable)

    if (unavailable) {
      toast.error(`${unavailable.product_name} is currently unavailable and can't be requested.`)
      return
    }

    // The minimum is checked again by the database when the request is saved.
    const belowMinimum = selectedProducts.find(
      (item) => item.quantity < minimumFor(item.product_id)
    )

    if (belowMinimum) {
      const product = products.find((p) => p.id === belowMinimum.product_id)
      toast.error(`${product?.product_name || 'A product'} has a minimum order of ${minimumFor(belowMinimum.product_id)} ${product?.unit || 'units'}.`)
      return
    }

    onSubmit({
      ...form,
      items: selectedProducts,
      replaces_request_id: initial?.replaces?.id || null,
    })
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            {initial ? 'Request a New Quote' : 'Add Quotation Request'}
          </h2>

          {initial && (
            <p className="mt-1 text-sm text-gray-600">
              In place of {initial.replaces.reference}, whose quotation expired. Its products are filled in: change them if you like,
              and pick a new preferred shipping date. DMC prices it again with today's prices.
            </p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Preferred Shipping Date
              </label>

              <input
                type="date"
                value={form.preferred_ship_date}
                min={earliestShipDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    preferred_ship_date: e.target.value,
                  })
                }
                className="w-full rounded-lg border px-3 py-2"
                required
              />
            </div>


            <div>
              <label className="mb-1 block text-sm font-medium">
                Delivery Location
              </label>

              <select
                value={form.delivery_location_id}
                onChange={(e) =>
                  setForm({
                    ...form,
                    delivery_location_id: e.target.value,
                  })
                }
                className="w-full rounded-lg border px-3 py-2"
                required
              >
                <option value="">Select Location</option>

                {deliveryLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.location_name}
                  </option>
                ))}
              </select>
            </div>


            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium">
                  Products
                </label>

                {selectedProducts.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      openSelected()?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                    className="text-xs font-medium text-green-700 hover:underline"
                  >
                    {selectedProducts.length} selected · View all
                  </button>
                )}
              </div>

              <input
                type="search"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search by product or brand, e.g. corned beef"
                className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
              />

              <div className="space-y-3 max-h-80 overflow-y-auto">

                {visibleGroups.length === 0 && (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No products match "{productSearch}".
                  </p>
                )}

                {visibleGroups.map((group) => (
                  <div key={group.key} className="rounded-lg border p-3">
                    <p className="break-words font-medium">
                      {group.family}
                    </p>

                    {group.brand && (
                      <p className="text-sm text-gray-500">
                        {group.brand}
                      </p>
                    )}

                    <div className="mt-2 space-y-2">
                      {group.items.map((product) => {
                        const selected = selectedProducts.some(
                          (p) => p.product_id === product.id
                        )
                        const unavailable = isUnavailable(product)

                        // The whole row ticks the box. Quantity and notes are set
                        // in Selected Products below the list.
                        return (
                          <label
                            key={product.id}
                            className={`flex items-center gap-3 rounded-md p-2 ${
                              selected ? 'bg-green-50 ring-1 ring-green-200' : 'bg-gray-50'
                            } ${unavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={unavailable}
                              title={unavailable ? 'This product is currently unavailable' : undefined}
                              onChange={(e) => setPicked(product, e.target.checked)}
                            />

                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800">
                                {sizeLabel(product)}
                                {product.unit && (
                                  <span className="ml-2 font-normal text-green-600">
                                    · per {product.unit}
                                  </span>
                                )}
                              </p>

                              {unavailable ? (
                                <p className="text-xs font-medium text-red-700">
                                  Unavailable — can't be requested right now
                                </p>
                              ) : minimums[product.id] && (
                                <p className="text-xs font-medium text-amber-700">
                                  Minimum order: {minimums[product.id]} {product.unit || 'units'}
                                </p>
                              )}
                            </div>

                            {selected && (
                              <span className="text-xs font-medium text-green-700">
                                Added
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
            </div>

              {/* Every selected product in one place, wherever it sits in the
                  list, with its quantity and notes. Click the heading to
                  collapse or expand it. */}
              <details id="selected-products" open className="group mt-4 scroll-mt-4">
                <summary className="mb-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span>Selected Products ({selectedProducts.length})</span>

                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                    <span className="group-open:hidden">Show</span>
                    <span className="hidden group-open:inline">Hide</span>
                    <FontAwesomeIcon icon={faChevronDown} className="h-3 w-3 transition-transform group-open:rotate-180"/>
                  </span>
                </summary>

                {selectedProducts.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-gray-500">
                    Tick products above and they'll appear here.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {selectedProducts.map((item) => {
                      const product = products.find((p) => p.id === item.product_id) || { id: item.product_id }
                      const name = product.family || product.product_name || 'Product'

                      return (
                        <li key={item.product_id} className="rounded-lg border p-3">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-medium text-gray-800">
                                {name}
                              </p>

                              <p className="text-xs text-gray-500">
                                {sizeLabel(product)}
                                {product.brand ? ` · ${product.brand}` : ''}
                              </p>

                              {minimums[item.product_id] && (
                                <p className="text-xs font-medium text-amber-700">
                                  Minimum order: {minimums[item.product_id]} {product.unit || 'units'}
                                </p>
                              )}
                            </div>

                            <input
                              type="number"
                              min={minimumFor(item.product_id)}
                              step={1}
                              required
                              value={item.quantity}
                              aria-label={`Quantity of ${name}, ${sizeLabel(product)}`}
                              onChange={(e) =>
                                updatePicked(item.product_id, {
                                  // Keep a cleared field empty. Number('') is 0,
                                  // which made typing "5" show "05".
                                  quantity: e.target.value === '' ? '' : Number(e.target.value),
                                })
                              }
                              className="w-20 rounded border px-2 py-1"
                            />

                            <span className="pt-1.5 text-sm text-gray-500">
                              {product.unit || 'units'}
                            </span>

                            <button
                              type="button"
                              onClick={() => setPicked(product, false)}
                              title={`Remove ${name}, ${sizeLabel(product)}`}
                              aria-label={`Remove ${name}, ${sizeLabel(product)}`}
                              className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <FontAwesomeIcon icon={faXmark}/>
                            </button>
                          </div>

                          <textarea
                            rows={1}
                            placeholder="Notes for this product (optional)"
                            value={item.notes}
                            onChange={(e) => updatePicked(item.product_id, { notes: e.target.value })}
                            className="mt-2 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                          />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </details>
          </div>
          </div>

          {shipEstimate?.estimatedShipDate && (
            <ShipEstimateNote
              estimate={shipEstimate}
              lead="If the down payment were made today, orders like this would ship around"
              preferredDate={form.preferred_ship_date}
            />
          )}

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 transition hover:bg-gray-100"
            >
              Cancel
            </button>

            <button
              type="submit"
              onClick={openSelected}
              className="rounded-lg bg-[#1F3A2C] px-4 py-2 text-white transition hover:bg-[#2D5A42]"
            >
              Submit Request
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per quotation request, as listed.
// =============================================
const myRequestColumns = (requests) => [
  { header: 'Reference', value: (request) => request.quotation_reference },
  { header: 'New quote for', value: (request) => requests.find((other) => other.id === request.replaces_request_id)?.quotation_reference || '' },
  { header: 'Delivery location', value: (request) => request.delivery_locations?.location_name },
  { header: 'Country', value: (request) => request.delivery_locations?.country },
  { header: 'Status', value: (request) => statusText(request.status) },
  { header: 'Requested', value: (request) => dateTime(request.created_at) },
  { header: 'Products', value: (request) => productsText(request.quotation_request_items) },
]


// =============================================
// CHANGE A REQUEST'S DELIVERY LOCATION (037)
//
// Before it's an order. Not priced yet: it just goes to the new location.
// Priced: its quotation is withdrawn and DMC prices it again for the new
// location (the price can change: markup and shipping go by country).
// =============================================
function ChangeLocationModal({ request, locations, onClose, onChanged }) {
  const { toast } = useToast()
  const choices = (locations || []).filter((location) => location.id !== request.delivery_location_id)
  const [locationId, setLocationId] = useState(choices[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const priced = request.status === 'priced & sent to customer'
  const current = request.delivery_locations
  const chosen = choices.find((location) => location.id === locationId)

  async function save() {
    if (!locationId || saving) return
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('change_request_location', { p_request_id: request.id, p_location_id: locationId })
      if (error) {
        toast.error(error.code === 'PGRST202' || /change_request_location/.test(error.message || '')
          ? 'Changing a delivery location needs db/migrations/037 to be run first.'
          : error.message || 'The delivery location could not be changed.')
        return
      }
      toast.success(data?.withdrawn
        ? `${request.quotation_reference} now goes to ${chosen?.location_name}. Quotation ${data.withdrawn} was withdrawn, and DMC prices it again for the new location.`
        : `${request.quotation_reference} now goes to ${chosen?.location_name}. DMC prices it for that location.`)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">Change Delivery Location</h2>
          <p className="text-sm text-gray-500">{request.quotation_reference}</p>
        </div>

        <div className="space-y-4 px-6 py-5 text-sm">
          <p className="text-gray-700">
            Now: <span className="font-medium">{[current?.location_name, current?.address, current?.country].filter(Boolean).join(', ') || '-'}</span>
          </p>

          {choices.length ? (
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">New delivery location</span>
              <select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42]"
              >
                {choices.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.location_name} · {location.address}, {location.country}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
              You have no other saved delivery location. Add the new address in Delivery Locations first.
            </p>
          )}

          <p className={`rounded-lg border p-3 ${priced ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
            {priced
              ? 'DMC has already priced this request for its current location. Changing it withdraws that quotation, and DMC prices the request again for the new location: the price can change, since the markup and shipping cost go by country.'
              : "DMC hasn't priced this request yet, so it is priced for the new location."}
          </p>
        </div>

        <div className="flex justify-end gap-3 bg-gray-50 px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!locationId || saving}
            className="rounded-md bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
          >
            {saving ? 'Changing...' : priced ? 'Change and Ask for a New Price' : 'Change Location'}
          </button>
        </div>
      </div>
    </div>
  )
}
