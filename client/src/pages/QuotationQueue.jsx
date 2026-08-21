'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileLines, faPenToSquare, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'


export default function QuotationQueuePage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [showModal, setShowModal] = useState(false)
  const [requests, setRequests] = useState([])
  const [currentRequest, setCurrentRequest] = useState(null)
  const [currentQuotation, setCurrentQuotation] = useState(null)


  // =============================================
  // LOAD QUEUES
  // =============================================
  async function loadQueues() {
    const { data, error } = await supabase
      .from('quotation_requests')
      .select(`
        id,
        quotation_reference,
        preferred_ship_date,
        status,
        created_at,
        profiles (
          company
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
            brand
          )
        )
      `)
      .order('created_at', { ascending: false })


    if (error) {
      toast.error(error.message)
      return
    }

    setRequests(data || [])
  }


  // =============================================
  // CREATE QUOTATION
  // =============================================
  async function generateQuotation(data) {
    const quotationNumber = `QT-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`

    // Create quotation
    const { data: quotation, error } = await supabase
      .from('quotations')
      .insert({
        quotation_request_id: currentRequest.id,
        quotation_number: quotationNumber,
        subtotal: data.subtotal,
        shipping_cost: data.shippingCost,
        total_amount: data.total,
        down_payment_amount: data.downPayment,
        expiry_date: data.expiryDate,
        status: 'pending approval',
      })
      .select()
      .single()

    if (error) {
      console.error(error)
      return
    }

    // Create quotation items
    const quotationItems = data.items.map((item) => ({
      quotation_id: quotation.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.quantity * item.unit_price,
    }))

    const { error: itemError } = await supabase
      .from('quotation_items')
      .insert(quotationItems)

    if (itemError) {
      toast.error(itemError)

      // Roll back quotation if item insert fails
      await supabase
        .from('quotations')
        .delete()
        .eq('id', quotation.id)

      return
    }

    // Update request status
    const { error: updateError } = await supabase
      .from('quotation_requests')
      .update({
        status: 'quoted',
      })
      .eq('id', currentRequest.id)

    if (updateError) {
      toast.error(updateError)
      return
    }

    setShowModal(false)
    setCurrentRequest(null)
    loadQueues()
  }


  // =============================================
  // DELETE REQUEST
  // =============================================
  async function deleteRequest(requestId) {
    const request = requests.find((request) => request.id === requestId)

    if (!request) return

    if (request.status !== 'rejected') {
      alert('Only rejected quotation requests can be deleted.')
      return
    }

    const confirmed = window.confirm(
      'Are you sure you want to delete this rejected quotation request?'
    )

    if (!confirmed) return


    /* FIND QUOTATION */
    const { data: quotation, error: quotationFetchError } = await supabase
      .from('quotations')
      .select('id')
      .eq('quotation_request_id', requestId)
      .maybeSingle()

    if (quotationFetchError) {
      toast.error('Failed to find quotation.')
      return
    }


    /* DELETE QUOTATION */
    if (quotation) {
      const { error: quotationError } = await supabase
        .from('quotations')
        .delete()
        .eq('id', quotation.id)

      if (quotationError) {
        toast.error('Failed to delete quotation.')
        return
      }
    }


    /* DELETE QUOTATION REQUESTS ITEMS */
    const { error: itemError } = await supabase
      .from('quotation_request_items')
      .delete()
      .eq('quotation_request_id', requestId)

    if (itemError) {
      toast.error('Failed to delete quotation request items.')
      return
    }


    /* DELETE QUOTATION REQUESTS */
    const { error: requestError } = await supabase
      .from('quotation_requests')
      .delete()
      .eq('id', requestId)

    if (requestError) {
      toast.error('Failed to delete quotation request.')
      return
    }

    toast.success('Quotation deleted successfully')
    await loadQueues()
  }


  // =============================================
  // OPEN QUOTATION MODAL
  // =============================================
  async function openInfoModal(request) {
    setCurrentRequest(request)

    if (request.status === 'pending') {
      setShowModal(true)
      return
    }

    if (request.status === 'quoted') {
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
        .eq('quotation_request_id', request.id)
        .single()

      if (error) {
        toast.error('Failed to load quotation.')
        return
      }

      setCurrentQuotation(data)
      setShowModal(true)
    }
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
  return (
    <div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Quotation Queue
          </h1>

          <p className="text-gray-500">
            View your customers' quotation requests and their current status.
          </p>
        </div>
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
                    {request.profiles?.company || '-'}
                  </td>

                  <td className="px-5 py-3">
                    {request.delivery_locations?.location_name || '-'}
                  </td>

                  <td className="px-5 py-3">
                    {request.delivery_locations?.contact_number || '-'}
                  </td>

                  <td className="px-5 py-3">
                    <StatusBadge status={request.status} />
                  </td>

                  <td className="px-5 py-3">
                    {new Date(request.created_at).toLocaleDateString()}
                  </td>

                  <td className="px-5 py-3">
                    {request.status === 'quoted' && (
                      <IconButton icon={faFileLines} title="View Quotation" color="blue" disabled={false} onClick={() => openInfoModal(request)}/>
                    )}

                    {request.status === 'pending' && (
                      <IconButton icon={faPenToSquare} title="View Quotation" color="yellow" disabled={false} onClick={() => openInfoModal(request)}/>
                    )}

                    {request.status === 'rejected' && (
                      <IconButton icon={faTrash} title="Delete Request" color="red" disabled={false} onClick={() => deleteRequest(request.id)}/>
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


      {showModal && currentRequest?.status === 'pending' && (
        <QuotationModal
          request={currentRequest}
          onClose={() => {
            setShowModal(false)
            setCurrentRequest(null)
          }}
          onSubmit={generateQuotation}
        />
      )}

      {showModal && currentRequest?.status === 'quoted' && (
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
              <p className="mt-1 font-medium text-gray-800"> {new Date(quotation.created_at).toLocaleDateString()} </p>
            </div>
          </div>


          {/* =================================================
              ITEMS
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Quotation Items
          </h3>

          <div className="overflow-hidden rounded-lg border">
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
                    Unit Price
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
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
                    </td>


                    {/* QUANTITY */}
                    <td className="px-4 py-4 text-right">
                      {item.quantity}
                    </td>


                    {/* UNIT PRICE */}
                    <td className="px-4 py-4 text-right">
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
          </div>


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
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
function QuotationModal({ request, onClose, onSubmit }) {
  const [shippingCost, setShippingCost] = useState(0)
  const [expiryDate, setExpiryDate] = useState('')
  const [items, setItems] = useState(
    request.quotation_request_items.map((item) => ({
      product_id: item.products.id,
      product_name: item.products.product_name,
      brand: item.products.brand,
      quantity: item.quantity,
      notes: item.notes,
      unit_price: 0,
    }))
  )

  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * Number(item.unit_price || 0),
    0
  )

  const total = subtotal + Number(shippingCost || 0)
  const downPayment = total * 0.5


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

          <button onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>



        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="flex-1 overflow-y-auto p-6">



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

              <div className="overflow-hidden rounded-lg border">
                <table className="min-w-full">

                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Product
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Quantity
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Notes
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
                        (item, index) => {
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
                              </td>


                              {/* QUANTITY */}
                              <td className=" px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.quantity}
                                </p>
                              </td>


                              {/* NOTES */}
                              <td className=" px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.notes || '-'}
                                </p>
                              </td>


                              {/* UNIT PRICE */}
                              <td className="px-4 py-4">
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                                    ₱
                                  </span>

                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.unit_price}
                                    onChange={(e) => {
                                      const copy = [...items]
                                      copy[index].unit_price = Number(e.target.value)
                                      setItems(copy)
                                    }}
                                    placeholder="0.00"
                                    className="w-36 rounded-md border border-gray-300 py-2 pl-7 pr-3 text-right text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                                  />
                                </div>
                              </td>


                              {/* SUBTOTAL */}
                              <td className="px-4 py-4 text-right font-medium text-gray-800">
                               ₱{(item.quantity * item.unit_price).toLocaleString()}
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
              </div>


              {/* =================================================
                  TOTAL
              ================================================= */}
              <div className="mt-6 flex justify-end">
                <div className="w-full max-w-sm">

                  <h3 className="mb-4 text-sm font-semibold text-gray-800">
                    Quotation Summary
                  </h3>

                  <div className="rounded-lg bg-gray-50 p-5">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Shipping Cost
                      </span>

                      <input
                        type="number"
                        value={shippingCost}
                        onChange={(e) => setShippingCost(Number(e.target.value))}
                        className="w-36 rounded-md border border-gray-300 bg-white px-3 py-2 text-right text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                      />
                    </div>


                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Expiry Date <span className="text-red-500">*</span>
                      </span>

                      <input
                        type="date"
                        value={expiryDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        required
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                      />
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

                    <div className="mb-3 flex justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Shipping
                      </span>

                      <span className="font-semibold text-gray-800">
                        ₱{shippingCost.toLocaleString()}
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
                      <button onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" >
                        Cancel
                      </button>

                      <button
                        onClick={() => {
                          if (!expiryDate) {
                            alert('Please select an expiry date.')
                            return
                          }

                          const confirmed = window.confirm(
                            'Are you sure you want to generate this quotation?\n\n' +
                            'Once generated, the customer will be able to view and respond to the quotation.'
                          )

                          if (!confirmed) return

                          onSubmit({
                            items,
                            shippingCost,
                            expiryDate,
                            subtotal,
                            total,
                            downPayment,
                          })
                        }}
                        className="rounded-md bg-[#1F3A2C] px-4 py-2 text-sm font-medium text-white hover:bg-[#2D5A42]"
                      >
                        Generate Quotation
                      </button>
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