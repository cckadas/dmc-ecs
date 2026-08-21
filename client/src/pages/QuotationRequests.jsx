'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faEye } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'


export default function QuotationRequestsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()
  
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [products, setProducts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [requests, setRequests] = useState([])
  const [showQuotationModal, setShowQuotationModal] = useState(false)
  const [selectedQuotation, setSelectedQuotation] = useState(null)
  const [loadingQuotation, setLoadingQuotation] = useState(false)


  // =============================================
  // LOAD REQUESTS
  // =============================================
  async function loadRequests() {
    const { data, error } = await supabase
      .from('quotation_requests')
      .select(`
        id,
        quotation_reference,
        status,
        created_at,
        delivery_locations (
          location_name,
          address,
          country
        ),
        quotation_request_items (
          id,
          quantity,
          notes,
          products (
            product_name,
            brand
          )
        )
      `)
      .eq('customer_id', profile.id)
      .order('created_at', { ascending: false })

    if (error) {
      toast.error(error.message)
      return
    }

    setRequests(data || [])
  }


  // =============================================
  // LOAD DELIVERY LOCATIONS
  // =============================================
  async function loadDeliveryLocations() {
    const { data, error } = await supabase
      .from('delivery_locations')
      .select('*')
      .eq('profile_id', profile.id)
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
      .select('id, product_name, brand')
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

    const { data: request, error } = await supabase
      .from('quotation_requests')
      .insert({
        quotation_reference: quotationReference,
        customer_id: profile.id,
        delivery_location_id: formData.delivery_location_id,
        preferred_ship_date: formData.preferred_ship_date,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      toast.error(error)
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
      toast.error(itemError)
      return
    }

    setShowModal(false)
    loadRequests()
  }


  // =============================================
  // DELETE REQUEST
  // =============================================
  async function deleteRequest(requestId) {
    const confirmed = window.confirm(
      'Are you sure you want to delete this quotation request?'
    )

    if (!confirmed) return

    // Delete child records first
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

    const { data, error } = await supabase
      .from('quotations')
      .select(`
        id,
        quotation_request_id,
        quotation_number,
        subtotal,
        shipping_cost,
        total_amount,
        down_payment_amount,
        expiry_date,
        status,
        created_at,
        quotation_items (
          id,
          product_id,
          quantity,
          unit_price,
          subtotal,
          products (
            product_name,
            brand
          )
        )
      `)
      .eq('quotation_request_id', requestId)
      .single()

    setLoadingQuotation(false)

    if (error) {
      toast.error('Failed to load quotation.')
      return
    }

    setSelectedQuotation(data)
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

    // Get the quotation request ID
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('quotation_request_id')
      .eq('id', quotationId)
      .eq('status', 'pending approval')
      .single()

    if (fetchError || !quotation) {
      console.error(fetchError)
      alert('Quotation is no longer available for rejection.')
      return
    }

    // Update quotation status
    const { error: quotationError } = await supabase
      .from('quotations')
      .update({
        status: 'rejected',
      })
      .eq('id', quotationId)
      .eq('status', 'pending approval')

    if (quotationError) {
      console.error(quotationError)
      toast.error('Failed to reject quotation.')
      return
    }

    // Update quotation request status
    const { error: requestError } = await supabase
      .from('quotation_requests')
      .update({
        status: 'rejected',
      })
      .eq('id', quotation.quotation_request_id)

    if (requestError) {
      console.error(requestError)
      toast.error('Quotation was rejected, but failed to update the request status.')
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

    const confirmed = window.confirm(
      'Are you sure you want to approve this quotation?'
    )

    if (!confirmed) return


    try {

      /* CREATE CUSTOMER ORDERS */
      const now = new Date()
      const year = now.getFullYear()

      const {data: latestORD, error: latestORDError} = await supabase
        .from('customer_orders')
        .select('order_number')
        .like(
          'order_number',
          `ORD-${year}-%`
        )
        .order('created_at', {
          ascending: false
        })
        .limit(1)

      if (latestORDError) {
        throw latestORDError
      }

      let nextNumber = 1

      if (latestORD && latestORD.length > 0 && latestORD[0].order_number) {
        const match = latestORD[0].order_number.match(/^ORD-\d{5}-(\d+)$/)

        if (match) {
          nextNumber = Number(match[1]) + 1
        }
      }

      const orderNumber = `ORD-${year}-${String(nextNumber).padStart(5, '0')}`

      const { data: order, error: orderError } = await supabase
        .from('customer_orders')
        .insert({
          order_number: orderNumber,
          customer_id: profile.id,
          quotation_number: quotation.quotation_number,
          subtotal: quotation.subtotal,
          shipping_cost: quotation.shipping_cost,
          total_amount: quotation.total_amount,
          down_payment_amount: quotation.down_payment_amount,
          status: 'pending payment',
        })
        .select()
        .single()

      if (orderError) {
        console.error(orderError)
        alert('Failed to create customer order.')
        return
      }


      /* CREATE CUSTOMER ORDER ITEMS */
      const orderItems = quotation.quotation_items.map((item) => ({
        customer_order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      }))

      const { error: itemError } = await supabase
        .from('customer_order_items')
        .insert(orderItems)

      if (itemError) {
        console.error(itemError)
        await supabase
          .from('customer_orders')
          .delete()
          .eq('id', order.id)

        alert('Failed to create customer order items.')
        return
      }


      /* DELETE QUOTATION ITEMS */
      const { error: quotationItemsError } = await supabase
        .from('quotation_items')
        .delete()
        .eq('quotation_id', quotation.id)

      if (quotationItemsError) {
        console.error(quotationItemsError)
        alert('Order was created, but quotation items could not be deleted.')
        return
      }


      /* DELETE QUOTATION */
      const { error: quotationError } = await supabase
        .from('quotations')
        .delete()
        .eq('id', quotation.id)

      if (quotationError) {
        console.error(quotationError)
        alert('Order was created, but quotation could not be deleted.')
        return
      }


      /* DELETE QUOTATION REQUEST ITEMS */
      const { error: requestItemsError } = await supabase
        .from('quotation_request_items')
        .delete()
        .eq('quotation_request_id', quotation.quotation_request_id)

      if (requestItemsError) {
        console.error(requestItemsError)
        alert(
          'Order was created, but quotation request items could not be deleted.'
        )
        return
      }


      /* DELETE QUOTATION REQUEST */
      const { error: requestError } = await supabase
        .from('quotation_requests')
        .delete()
        .eq('id', quotation.quotation_request_id)

      if (requestError) {
        console.error(requestError)
        alert(
          'Order was created, but quotation request could not be deleted.'
        )
        return
      }


      /* SUCCESS */
      toast.success('Quotation approved successfully.')

      setShowQuotationModal(false)
      setSelectedQuotation(null)

      await loadRequests()
    }
    
    catch (error) {
      console.error(error)
      alert('Something went wrong while approving the quotation.')
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
    }
  }, [profile])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Quotation Requests
          </h1>

          <p className="text-gray-500">
            View your submitted quotation requests.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633]"
        >
          <FontAwesomeIcon icon={faPlus}/>
          Create Quotation Request
        </button>
      </div>


      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
            {requests.length > 0 ? (
              requests.map((request) => (
                <tr
                  key={request.id}
                  className="border-t border-gray-200 text-sm hover:bg-gray-50"
                >

                  <td className="px-5 py-3 font-medium text-gray-800">
                    {request.quotation_reference}
                  </td>

                  <td className="px-5 py-3">
                    {request.delivery_locations?.location_name || '-'}
                  </td>

                  <td className="px-5 py-3">
                    <div className="space-y-2">
                      {request.quotation_request_items?.length > 0 ? (
                        request.quotation_request_items.map((item) => (
                          <div key={item.id}>
                            <div className="font-medium">
                              {item.products?.product_name}
                              <span className="ml-2 text-sm font-normal text-gray-500">
                                × {item.quantity}
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
                    {new Date(request.created_at).toLocaleDateString()}
                  </td>

                  <td className="px-5 py-3">
                    {request.status === 'quoted' ? (
                      <IconButton icon={faEye} title="View Quotation" color="blue" disabled={false} onClick={() => viewQuotation(request.id)}/>
                    ) : (
                      <IconButton icon={faTrash} title={request.status === 'pending' ? 'Cancel Request' : 'Cannot cancel this request'} color="red" disabled={request.status !== 'pending'} onClick={() => deleteRequest(request.id)}/>
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
                  No quotation requests found.
                </td>
              </tr>
            )}

          </tbody>
        </table>
      </div>

    {showModal && (
      <QuotationRequestModal
        deliveryLocations={deliveryLocations}
        products={products}
        onClose={() => setShowModal(false)}
        onSubmit={saveRequest}
      />
    )}

    {showQuotationModal && (
      <QuotationModal
        quotation={selectedQuotation}
        loading={loadingQuotation}
        onApprove={approveQuotation}
        onReject={rejectQuotation}
        onClose={() => {
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
function QuotationModal({ quotation, loading, onClose, onApprove, onReject }) {
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

  const isExpired = new Date() > new Date(`${quotation.expiry_date}T23:59:59`)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-[#1F3A2C]">
              Quotation
            </h2>

            <p className="text-sm text-gray-500">
              {quotation.quotation_number}
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-2xl text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        {/* Quotation Information */}
        <div className="grid grid-cols-2 gap-4 px-6 py-5">
          <div>
            <p className="text-xs font-medium uppercase text-gray-500">
              Quotation Number
            </p>

            <p className="font-medium text-gray-800">
              {quotation.quotation_number}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase text-gray-500">
              Status
            </p>

            <p className="font-medium text-gray-800">
              {quotation.status}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase text-gray-500">
              Expiry Date
            </p>

            <p className="font-medium text-gray-800">
              {new Date(quotation.expiry_date).toLocaleDateString()}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase text-gray-500">
              Created
            </p>

            <p className="font-medium text-gray-800">
              {new Date(quotation.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Items */}
        <div className="px-6">
          <h3 className="mb-3 font-semibold text-gray-800">
            Quotation Items
          </h3>

          <div className="overflow-hidden rounded-lg border">
            <table className="min-w-full">
              <thead className="bg-[#F4F8F5]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">
                    Product
                  </th>

                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-gray-600">
                    Quantity
                  </th>

                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-600">
                    Unit Price
                  </th>

                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-600">
                    Subtotal
                  </th>
                </tr>
              </thead>

              <tbody>
                {quotation.quotation_items?.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-gray-200"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">
                        {item.products?.product_name}
                      </div>

                      {item.products?.brand && (
                        <div className="text-xs text-gray-500">
                          {item.products.brand}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      {item.quantity}
                    </td>

                    <td className="px-4 py-3 text-right">
                      ₱ {Number(item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>

                    <td className="px-4 py-3 text-right font-medium">
                      ₱ {Number(item.subtotal).toLocaleString(undefined,{ minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end px-6 py-5">
          <div className="w-72 space-y-2">

            <div className="flex justify-between text-sm">
              <span className="text-gray-500">
                Subtotal
              </span>

              <span>
                ₱{Number(quotation.subtotal).toLocaleString(
                  undefined,
                  { minimumFractionDigits: 2 }
                )}
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-500">
                Shipping
              </span>

              <span>
                ₱{Number(quotation.shipping_cost).toLocaleString(
                  undefined,
                  { minimumFractionDigits: 2 }
                )}
              </span>
            </div>

            <div className="border-t pt-2">
              <div className="flex justify-between">
                <span className="font-semibold text-gray-800">
                  Total
                </span>

                <span className="text-lg font-bold text-[#1F3A2C]">
                  ₱{Number(quotation.total_amount).toLocaleString(
                    undefined,
                    { minimumFractionDigits: 2 }
                  )}
                </span>
              </div>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-500">
                Down Payment
              </span>

              <span className="font-medium">
                ₱{Number(quotation.down_payment_amount).toLocaleString(
                  undefined,
                  { minimumFractionDigits: 2 }
                )}
              </span>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-gray-50 px-6 py-4">
          {quotation.status === 'rejected' ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-red-600">
                  Quotation Rejected
                </p>

                <p className="text-sm text-gray-500">
                  This quotation has already been rejected.
                </p>
              </div>

              <button
                onClick={onClose}
                className="rounded-lg bg-gray-200 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          ) : quotation.status === 'approved' ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-green-600">
                  Quotation Approved
                </p>

                <p className="text-sm text-gray-500">
                  This quotation has already been approved.
                </p>
              </div>

              <button
                onClick={onClose}
                className="rounded-lg bg-[#2D5A42] px-5 py-2 text-sm font-medium text-white hover:bg-[#234633]"
              >
                Close
              </button>
            </div>
          ) : isExpired ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-red-600">
                  Quotation Expired
                </p>

                <p className="text-sm text-gray-500">
                  This quotation has expired. Please request a refreshed quote
                  before proceeding.
                </p>
              </div>

              <button
                onClick={onClose}
                className="rounded-lg bg-gray-200 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>

              <button
                onClick={() => onReject(quotation.id)}
                className="rounded-lg border border-red-200 bg-red-50 px-5 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
              >
                Reject
              </button>

              <button
                onClick={() => onApprove(quotation.id)}
                className="rounded-lg bg-[#2D5A42] px-5 py-2 text-sm font-medium text-white hover:bg-[#234633]"
              >
                Approve Quotation
              </button>
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
function QuotationRequestModal({ deliveryLocations, products, onClose, onSubmit }) {
  const [selectedProducts, setSelectedProducts] = useState([])

  const [form, setForm] = useState({
    preferred_ship_date: '',
    delivery_location_id: '',
  })


  function handleSubmit(e) {
    e.preventDefault()

    if (
      !form.delivery_location_id ||
      !form.preferred_ship_date ||
      selectedProducts.length === 0
    ) {
      return
    }

    onSubmit({
      ...form,
      items: selectedProducts,
    })
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Add Quotation Request
          </h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Preferred Shipping Date
              </label>

              <input
                type="date"
                value={form.preferred_ship_date}
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


            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium">
                Products
              </label>

              <div className="space-y-3 max-h-80 overflow-y-auto">

                {products.map((product) => {
                  const selected = selectedProducts.find(
                    (p) => p.product_id === product.id
                  )

                  return (
                    <div
                      key={product.id}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-4">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedProducts([
                                ...selectedProducts,
                                {
                                  product_id: product.id,
                                  quantity: 1,
                                  notes: '',
                                },
                              ])
                            } else {
                              setSelectedProducts(
                                selectedProducts.filter(
                                  (p) => p.product_id !== product.id
                                )
                              )
                            }
                          }}
                        />

                        <div className="flex-1">
                          <p className="font-medium">
                            {product.product_name}
                          </p>

                          <p className="text-sm text-gray-500">
                            {product.brand}
                          </p>
                        </div>

                        {selected && (
                          <input
                            type="number"
                            min={1}
                            value={selected.quantity}
                            onChange={(e) =>
                              setSelectedProducts(
                                selectedProducts.map((p) =>
                                  p.product_id === product.id
                                    ? {
                                        ...p,
                                        quantity: Number(e.target.value),
                                      }
                                    : p
                                )
                              )
                            }
                            className="w-20 rounded border px-2 py-1"
                          />
                        )}
                      </div>

                      {selected && (
                        <div className="mt-3">
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Notes
                          </label>

                          <textarea
                            rows={2}
                            placeholder="Optional notes for this product..."
                            value={selected.notes}
                            onChange={(e) =>
                              setSelectedProducts(
                                selectedProducts.map((p) =>
                                  p.product_id === product.id
                                    ? {
                                        ...p,
                                        notes: e.target.value,
                                      }
                                    : p
                                )
                              )
                            }
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
          </div>

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