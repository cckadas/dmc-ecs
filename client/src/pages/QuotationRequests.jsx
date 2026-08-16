'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'


export default function QuotationRequestsPage() {
  const { profile } = useAuth()
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [products, setProducts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [requests, setRequests] = useState([])


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
      alert(error.message)
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
      alert(error.message)
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
      alert(error.message)
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
        status: 'Pending',
      })
      .select()
      .single()

    if (error) {
      console.error(error)
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
      console.error(itemError)
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
      console.error(itemError)
      return
    }

    // Delete the quotation request
    const { error } = await supabase
      .from('quotation_requests')
      .delete()
      .eq('id', requestId)

    if (error) {
      console.error(error)
      return
    }

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
                      onClick={() => deleteRequest(request.id)}
                      className="rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                      title="Cancel Request"
                    >

                      <FontAwesomeIcon
                        icon={faTrash}
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
      <QuotationRequestModal
        deliveryLocations={deliveryLocations}
        products={products}
        onClose={() => setShowModal(false)}
        onSubmit={saveRequest}
      />
    )}

    </div>
  )
}



// =============================================
// AUOTATION REQUEST MODAL
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