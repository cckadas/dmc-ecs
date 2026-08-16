'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faFileLines, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'


export default function QuotationQueuePage() {

  const { profile } = useAuth()

  const [products, setProducts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [requests, setRequests] = useState([])
  const [currentRequest, setCurrentRequest] = useState([])

  const [form, setForm] = useState({

  })


  useEffect(() => {
    if (profile?.id) {
      loadQueues()
    }
  }, [profile])


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
      console.error(error)
      return
    }

    setRequests(data || [])
  }

  function openModal(request) {
    setCurrentRequest(request)
    setShowModal(true)
  }

  
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
        status: 'Pending Approval',
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
      console.error(itemError)

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
        status: 'Quoted',
      })
      .eq('id', currentRequest.id)

    if (updateError) {
      console.error(updateError)
      return
    }

    setShowModal(false)
    setCurrentRequest(null)
    loadQueues()
  }

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
                    <span className="
                      rounded-full
                      bg-yellow-100
                      px-3
                      py-1
                      text-xs
                      font-medium
                      text-yellow-700
                    ">
                      {request.status}
                    </span>
                  </td>

                  <td className="px-5 py-3">
                    {new Date(request.created_at).toLocaleDateString()}
                  </td>

                  <td className="px-5 py-3">
                    <button
                      onClick={() => openModal(request)}
                      className="rounded-md border border-blue-200 bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100"
                      title="View Quotation Request"
                    >

                      <FontAwesomeIcon
                        icon={faFileLines}
                        className="h-3.5 w-3.5"
                      />
                    </button>
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
        <QuotationModal
          request={currentRequest}
          onClose={() => setShowModal(false)}
          onSubmit={generateQuotation}
        />
      )}
    </div>
  )
}


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
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Fixed Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Generate Quotation
          </h2>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Information */}
          <div className="mb-6 rounded-lg border bg-gray-50 p-5">
            <h3 className="mb-4 text-lg font-semibold text-[#1F3A2C]">
              Customer Information
            </h3>

            <div className="grid grid-cols-2 gap-6">

              <div>
                <p className="text-sm text-gray-500">Reference</p>
                <p className="font-semibold">{request.quotation_reference}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Company</p>
                <p className="font-semibold">{request.profiles.company}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Preferred Ship Date</p>
                <p>{request.preferred_ship_date}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Delivery Location</p>
                <p>{request.delivery_locations.location_name}</p>
              </div>

            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">

              <div className="overflow-hidden rounded-lg border">
                <div className="max-h-[450px] overflow-y-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left">Product</th>
                        <th className="px-4 py-3 text-left">Brand</th>
                        <th className="px-4 py-3 text-center">Qty</th>
                        <th className="px-4 py-3 text-left">Notes</th>
                        <th className="px-4 py-3 text-right">Unit Price</th>
                        <th className="px-4 py-3 text-right">Subtotal</th>
                      </tr>
                    </thead>

                    <tbody>

                      {items.map((item, index) => (

                        <tr key={index} className="border-t">

                          <td className="px-4 py-3">
                            {item.product_name}
                          </td>

                          <td className="px-4 py-3">
                            {item.brand}
                          </td>

                          <td className="px-4 py-3 text-center">
                            {item.quantity}
                          </td>

                          <td className="px-4 py-3">
                            {item.notes || '-'}
                          </td>

                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min="0"
                              value={item.unit_price}
                              onChange={(e) => {
                                const copy = [...items]
                                copy[index].unit_price = Number(e.target.value)
                                setItems(copy)
                              }}
                              className="w-32 rounded border px-2 py-1 text-right"
                            />
                          </td>

                          <td className="px-4 py-3 text-right font-medium">
                            ₱{(item.quantity * item.unit_price).toLocaleString()}
                          </td>

                        </tr>

                      ))}

                    </tbody>
                  </table>
                </div>
              </div>
            </div>




              <div className="rounded-lg border bg-gray-50 p-5">
                <h3 className="mb-5 text-lg font-semibold text-[#1F3A2C]">
                    Quotation Summary
                </h3>

                {/* Shipping */}
                <div className="flex items-center justify-between mb-1">
                  <span>Shipping Cost</span>

                  <input
                    type="number"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(Number(e.target.value))}
                    className="w-36 rounded border px-2 py-1 text-right"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span>Expiry Date</span>

                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="rounded border px-2 py-1"
                  />
                </div>

                <hr className="my-5"/>

                {/* Totals */}
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>₱{subtotal.toLocaleString()}</span>
                </div>

                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>₱{shippingCost.toLocaleString()}</span>
                </div>

                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>₱{total.toLocaleString()}</span>
                </div>

                <div className="flex justify-between text-[#1F3A2C] font-bold">
                  <span>50% Down Payment</span>
                  <span>₱{downPayment.toLocaleString()}</span>
                </div>

                <hr className="my-5"/>

                {/* Buttons */}

                <div className="flex justify-end gap-3">

                  <button
                    onClick={onClose}
                    className="rounded-lg border px-4 py-2 hover:bg-gray-100"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={() =>
                      onSubmit({
                        items,
                        shippingCost,
                        expiryDate,
                        subtotal,
                        total,
                        downPayment,
                      })
                    }
                    className="rounded-lg bg-[#1F3A2C] px-4 py-2 text-white hover:bg-[#2D5A42]"
                  >
                    Generate Quotation
                  </button>
                </div>
              </div>


          </div>
        </div>
      </div>
    </div>
  )
}