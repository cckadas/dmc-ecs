'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faXmark, faCreditCard, faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'


export default function CustomerOrdersPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [orders, setOrders] = useState([])
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)


  // =============================================
  // LOAD ALL CUSTOMER ORDERS
  // =============================================
  async function loadCustomerOrders() {
    setLoading(true)

    const { data, error } = await supabase
      .from('customer_orders')
      .select(`
        id,
        order_number,
        customer_id,
        quotation_number,
        subtotal,
        shipping_cost,
        total_amount,
        down_payment_amount,
        status,
        settled_amount,
        payment_bank,
        payment_proof,
        created_at,

        customer_order_items (
          id,
          product_id,
          quantity,
          unit_price,
          subtotal,

          products (
            product_name,
            brand,
            unit
          )
        )
      `)
      .order('created_at', { ascending: false })


    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }


    // =============================================
    // GET CUSTOMER IDS
    // =============================================
    const customerIds = [
      ...new Set(
        (data || []).map(
          (order) => order.customer_id
        )
      ),
    ]


    // =============================================
    // LOAD CUSTOMER PROFILES
    // =============================================
    let profilesMap = {}


    if (customerIds.length > 0) {
      const { data: profiles, error: profileError } =
        await supabase
          .from('profiles')
          .select(`
            id,
            name,
            email,
            company,
            address,
            country
          `)
          .in('id', customerIds)


      if (profileError) {
        toast.error('Failed to load customer information.')
        setLoading(false)
        return
      }


      profilesMap = (profiles || []).reduce(
        (map, customer) => {
          map[customer.id] = customer
          return map
        },
        {}
      )
    }


    // =============================================
    // COMBINE ORDER + CUSTOMER
    // =============================================
    const formattedOrders = (data || []).map(
      (order) => ({
        ...order,

        customer:
          profilesMap[order.customer_id] || null,
      })
    )


    setOrders(formattedOrders)
    setLoading(false)
  }


  // =============================================
  // UPDATE PAYMENT STATUS
  // =============================================
  async function updatePaymentStatus(orderId, status) {
    const action = status === 'payment verified'
      ? 'accept'
      : 'reject'

    const confirmed = window.confirm(
      `Are you sure you want to ${action} this payment?`
    )

    if (!confirmed) return

    const { error } = await supabase
      .from('customer_orders')
      .update({
        status,
      })
      .eq('id', orderId)
      .eq('status', 'submitted')

    if (error) {
      toast.error(`Failed to ${action} payment.`)
      return
    }

    // Update selected payment immediately
    setSelectedPayment((prev) => ({
      ...prev,
      status,
    }))

    toast.success(`Payment ${action} has been successful.`)
    await loadCustomerOrders()
  }


  // =============================================
  // OPEN ORDER MODAL
  // =============================================
  function openOrderModal(order) {
    setSelectedOrder(order)
    setShowModal(true)
  }


  // =============================================
  // OPEN ORDER MODAL
  // =============================================
  function openPaymentModal(order) {
    setSelectedPayment(order)
    setShowPaymentModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadCustomerOrders()
    }
  }, [profile?.id])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Customer Orders
        </h1>

        <p className="text-gray-500">
          View and manage customer orders.
        </p>
      </div>


      {/* TABLE */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

        <table className="min-w-full">

          {/* TABLE HEADER */}
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Order Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Customer
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Company
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Quotation
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Total
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Date
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Action
              </th>
            </tr>
          </thead>


          {/* TABLE BODY */}
          <tbody>

            {loading ? (

              <tr>
                <td
                  colSpan="8"
                  className="py-10 text-center text-sm text-gray-500"
                >
                  Loading customer orders...
                </td>
              </tr>

            ) : orders.length > 0 ? (

              orders.map((order) => (

                <tr
                  key={order.id}
                  className="border-t border-gray-200 text-sm hover:bg-gray-50"
                >

                  {/* ORDER NUMBER */}
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {order.order_number || '-'}
                  </td>


                  {/* CUSTOMER */}
                  <td className="px-5 py-3">
                    {order.customer?.name || '-'}
                  </td>


                  {/* COMPANY */}
                  <td className="px-5 py-3">
                    {order.customer?.company || '-'}
                  </td>


                  {/* QUOTATION */}
                  <td className="px-5 py-3">
                    {order.quotation_number || '-'}
                  </td>


                  {/* TOTAL */}
                  <td className="px-5 py-3 font-medium">
                    ₱{' '}
                    {Number(
                      order.total_amount || 0
                    ).toLocaleString(
                      undefined,
                      {
                        minimumFractionDigits: 2,
                      }
                    )}
                  </td>


                  {/* STATUS */}
                  <td className="px-5 py-3">
                    <StatusBadge
                      status={order.status}
                    />
                  </td>


                  {/* DATE */}
                  <td className="px-5 py-3">
                    {new Date(
                      order.created_at
                    ).toLocaleDateString()}
                  </td>


                  {/* ACTION */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">

                      {/* VIEW ORDER */}
                      <IconButton icon={faFolderOpen} title="View Purchase Order" color="blue" disabled={false} onClick={() => openOrderModal(order)}/>


                      {/* PAYMENT */}
                      <IconButton icon={faCreditCard} title={order.status === 'pending payment' ? 'Payment Not Yet Available' : 'View Payment'} color="green" disabled={order.status === 'pending payment'} onClick={() => openPaymentModal(order)}/>
                      

                    </div>
                  </td>




                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="8" className="py-10 text-center text-sm text-gray-500">
                  No customer orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


      {showModal && selectedOrder && (
        <CustomerOrderModal
          order={selectedOrder}
          onClose={() => {
            setShowModal(false)
            setSelectedOrder(null)
          }}
        />
      )}


      {showPaymentModal && selectedPayment && (
        <PaymentModal
          order={selectedPayment}
          onClose={() => {
            setShowPaymentModal(false)
            setSelectedPayment(null)
          }}
          onUpdateStatus={updatePaymentStatus}
        />
      )}
    </div>
  )
}








// =====================================================
// VIEW CUSTOMER ORDER MODAL
// =====================================================
function CustomerOrderModal({ order, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {order.order_number}
            </h2>

            <p className="text-sm text-gray-500">
              Customer Order
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
              CUSTOMER INFORMATION
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Customer Information
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Name </p>
              <p className="mt-1 font-medium text-gray-800"> {order.customer?.name || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Company </p>
              <p className="mt-1 font-medium text-gray-800"> {order.customer?.company || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Email </p>
              <p className="mt-1 font-medium text-gray-800"> {order.customer?.email || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Country </p>
              <p className="mt-1 font-medium text-gray-800"> {order.customer?.country || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Address </p>
              <p className="mt-1 font-medium text-gray-800"> {order.customer?.address || '-'} </p>
            </div>
          </div>


          {/* =================================================
              ORDER INFORMATION
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Order Information
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Order Number </p>
              <p className="mt-1 font-medium text-gray-800"> {order.order_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Quotation Number </p>
              <p className="mt-1 font-medium text-gray-800"> {order.quotation_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <p className="mt-1 font-medium text-gray-800"> <StatusBadge status={order.status}/> </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Date Created </p>
              <p className="mt-1 font-medium text-gray-800"> {new Date(order.created_at).toLocaleDateString()} </p>
            </div>
          </div>


          {/* =================================================
              ITEMS
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Customer Order Items
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
                    Unit
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
                {order.customer_order_items.map((item) => (
                  <tr key={item.id} className="border-t border-gray-200">

                    {/* PRODUCT */}
                    <td className="px-4 py-4">
                      {item.products?.product_name || '-'}
                    </td>


                    {/* QUANTITY */}
                    <td className="px-4 py-4 text-left">
                      {item.quantity}
                    </td>

                    {/* UNIT */}
                    <td className="px-4 py-4 text-left">
                      {item.products?.unit}
                    </td>


                    {/* UNIT PRICE */}
                    <td className="px-4 py-4 text-left">
                        ₱ {Number(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>


                    {/* SUBTOTAL */}
                    <td className="px-4 py-4 text-left">
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
                    ₱ {Number(order.subtotal || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2
                    })}
                  </span>
                </div>

                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping Cost
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.shipping_cost || 0).toLocaleString(undefined, {
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
                      ₱ {Number(order.total_amount || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-green-700">
                      Down Payment
                    </span>

                    <span className="text-lg font-bold text-green-800">
                      ₱ {Number(order.down_payment_amount || 0).toLocaleString(undefined, {
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
// PAYMENT MODAL
// =====================================================
function PaymentModal({ order, onClose, onUpdateStatus }) {
  const settledAmount = Number(order.settled_amount || 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">


        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {order.order_number}
            </h2>

            <p className="text-sm text-gray-500">
              Payment Information
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
              CUSTOMER INFORMATION
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Payment Status
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Order Number </p>
              <p className="mt-1 font-medium text-gray-800"> {order.order_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Quotation Number </p>
              <p className="mt-1 font-medium text-gray-800"> {order.quotation_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <p className="mt-1 font-medium text-gray-800"> <StatusBadge status={order.status}/> </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Date </p>
              <p className="mt-1 font-medium text-gray-800"> {new Date(order.created_at).toLocaleDateString()} </p>
            </div>
          </div>

          

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">

            {/* =================================================
                PAYMENT DETAILS
            ================================================= */}
            <div className="md:col-span-3">
              <h3 className="mb-4 text-sm font-semibold text-gray-800">
                Payment Details
              </h3>

              <div className="rounded-lg bg-gray-50 grid grid-cols-1 gap-4 md:grid-cols-3 p-4 ">
                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Bank
                  </p>

                  <p className="mt-1 font-medium text-gray-800">
                    {order.payment_bank || '-'}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Settled Amount
                  </p>

                  <p className="mt-1 font-medium text-gray-800">
                    ₱ {settledAmount.toLocaleString(undefined, {
                      minimumFractionDigits: 2
                    })}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase text-gray-500">
                    Payment Proof
                  </p>

                  {order.payment_proof ? (
                    <a
                      href={order.payment_proof}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100"
                    >
                      View Payment Proof
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">
                      No payment proof uploaded.
                    </p>
                  )}
                </div>
              </div>
            </div>


            {/* =================================================
                PAYMENT SUMMARY
            ================================================= */}
            <div className="md:col-span-2">
              <h3 className="mb-4 text-sm font-semibold text-gray-800">
                Payment Summary
              </h3>

              <div className="rounded-lg bg-gray-50 p-4">
                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Subtotal
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Purchase Total
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.shipping_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-xl font-bold text-gray-800">
                      ₱ {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-green-700">
                      Down Payment
                    </span>

                    <span className="text-lg font-bold text-green-800">
                      ₱ {Number(order.down_payment_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
            Cancel
          </button>

          {order.status === 'submitted' && (
            <>
              <button
                type="button"
                onClick={() => onUpdateStatus(order.id, 'payment rejected')}
                className="flex items-center gap-2 rounded-md border border-red-600 bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faCircleXmark} />
                Reject Payment
              </button>

              <button
                type="button"
                onClick={() => onUpdateStatus(order.id, 'payment verified')}
                className="flex items-center gap-2 rounded-md border border-green-600 bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faCircleCheck} />
                Approve Payment
              </button>
            </>
          )}
        </div>


      </div>
    </div>
  )
}