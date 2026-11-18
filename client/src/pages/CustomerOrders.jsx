'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faXmark, faCreditCard, faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'
import OrderProgress from '../components/OrderProgress'
import { predictOrders } from '../services/predictionService'
import ShipDateSummary from '../components/ShipDateSummary'
import TableScroll from '../components/TableScroll'
import DownPaymentDeadline from '../components/DownPaymentDeadline'
import { CANCELLATION_COLUMNS, columnsIf, withNewColumns } from '../utils/newColumns'
import { ALL, filterOrders, showChoices, sortOrders } from '../utils/orderStatusSort'


// What to tell the reviewer when a payment check is refused.
function paymentReviewError(error, action) {
  // Script 027 not run yet: say so plainly.
  if (error?.code === 'PGRST202' || /review_order_payment/.test(error?.message || '')) {
    return 'Checking payments needs db/migrations/027 to be run first.'
  }

  // A rule's own words, e.g. the payment was already checked by someone else.
  if (error?.code === 'P0001' && error.message) {
    return error.message
  }

  return `Failed to ${action} payment.`
}


export default function CustomerOrdersPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [orders, setOrders] = useState([])
  // Each order's estimate (or when it shipped), by order id.
  const [estimates, setEstimates] = useState({})
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  // True while a payment check is being saved, so it can't be clicked twice.
  const [reviewingPayment, setReviewingPayment] = useState(false)
  // Sales and admin check payments; management sees the page view only
  // (review_order_payment in db/migrations/027 refuses anyone else).
  const checksPayments = ['admin', 'sales'].includes(String(profile?.role || '').trim().toLowerCase())
  // Which orders the list shows (all, payments to check, or one status) and
  // how it's sorted (by status, or by date).
  const [show, setShow] = useState(ALL)
  const [sortBy, setSortBy] = useState('status')


  // =============================================
  // LOAD ALL CUSTOMER ORDERS
  //
  // Returns the orders too, for a caller that needs the latest of one.
  // =============================================
  async function loadCustomerOrders() {
    setLoading(true)

    // When and why an order was cancelled: asked again without them until
    // db/migrations/028 is run.
    const { data, error } = await withNewColumns((withCancellation) => supabase
      .from('customer_orders')
      .select(`
        id,
        order_number,
        customer_id,
        quotation_number,
        subtotal,
        container_size,
        container_cost,
        shipping_cost,
        estimated_ship_date,
        requested_ship_date,
        delivery_location_id,
        total_amount,
        down_payment_amount,
        status,
        settled_amount,
        pending_payment_amount,
        expiry_date,
        ${columnsIf(withCancellation, CANCELLATION_COLUMNS)}
        payment_bank,
        payment_proof_dp,
        payment_proof_complete,
        pfi_file_path,
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
      .order('created_at', { ascending: false }), CANCELLATION_COLUMNS)


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

    // Not needed to show the orders, so a failure just leaves the dates out.
    predictOrders(formattedOrders)
      .then((list) => setEstimates(Object.fromEntries(list.map((prediction) => [prediction.id, prediction]))))
      .catch((error) => console.error('Failed to estimate ship dates:', error))

    return formattedOrders
  }


  // =============================================
  // REVIEW A SUBMITTED PAYMENT
  //
  // The amount a customer types can't be trusted until it is checked against
  // their proof, so it waits in pending_payment_amount. Approving moves it
  // into settled_amount (what counts as paid, and lowers the customer's
  // debt); rejecting drops it. The first payment also moves the order to
  // payment verified / payment rejected; the balance payment leaves the
  // order's stage alone.
  // =============================================
  async function reviewPayment(order, approve) {

    const isRejecting = !approve
    const action = approve ? 'accept' : 'reject'
    const isFirstPayment = order.status === 'submitted'
    const pendingAmount = Number(order.pending_payment_amount || 0)
    const amountText = `₱ ${pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`

    if (pendingAmount <= 0 && !isFirstPayment) {
      toast.error('There is no payment waiting for verification.')
      return
    }


    // =============================================
    // GET REJECTION REASON
    // =============================================
    let rejectionReason = null

    if (isRejecting) {
      rejectionReason = window.prompt('Please provide a reason for rejecting this payment:')

      if (rejectionReason === null) {
        return
      }

      rejectionReason = rejectionReason.trim()

      if (!rejectionReason) {
        toast.error('A rejection reason is required.')
        return
      }
    }


    // =============================================
    // CONFIRM ACTION
    // =============================================
    const confirmed = window.confirm(
      isRejecting
        ? `Reject this payment of ${amountText}?\n\nReason: ${rejectionReason}`
        : `Approve this payment of ${amountText}?\n\nOnly approve if the proof shows exactly this amount received.`
    )

    if (!confirmed) return


    // =============================================
    // CHECK THE PAYMENT, IN ONE STEP
    //
    // The database counts the amount as paid (or drops it), moves a first
    // payment's order to payment verified or payment rejected, records it and
    // tells the customer: all of it, or none of it. It acts only on the
    // payment shown here (this amount and these proofs), so one already
    // checked by someone else, or sent again by the customer since, is
    // refused, and nothing is recorded or sent twice (db/migrations/027).
    // =============================================
    setReviewingPayment(true)

    try {
      const { data: reviewed, error } = await supabase.rpc('review_order_payment', {
        p_customer_order_id: order.id,
        p_approve: approve,
        p_expected_amount: pendingAmount,
        p_expected_proof_dp: order.payment_proof_dp ?? null,
        p_expected_proof_complete: order.payment_proof_complete ?? null,
        p_rejection_reason: rejectionReason,
      })

      if (error) {
        console.error('Failed to review payment:', error)
        toast.error(paymentReviewError(error, action))

        // Refused by a rule: the payment in this window is out of date.
        if (error.code === 'P0001') {
          const latest = (await loadCustomerOrders())?.find((row) => row.id === order.id)
          const anotherWaiting = latest && (latest.status === 'submitted' || Number(latest.pending_payment_amount || 0) > 0)

          if (latest && !anotherWaiting) {
            // Already checked by someone else: show it as it is now.
            setSelectedPayment((prev) => (prev?.id === order.id ? latest : prev))
          } else {
            // The customer sent another payment since. Close the window, so the
            // new one is opened and looked at before anyone approves it.
            setShowPaymentModal(false)
            setSelectedPayment(null)
          }
        }

        return
      }


      // =============================================
      // UPDATE SELECTED PAYMENT IMMEDIATELY
      // =============================================
      setSelectedPayment((prev) => (prev?.id === order.id
        ? {
            ...prev,
            status: reviewed.status,
            settled_amount: reviewed.settled_amount,
            pending_payment_amount: reviewed.pending_payment_amount,
            rejection_reason: reviewed.rejection_reason,
            payment_proof_complete: reviewed.payment_proof_complete,
          }
        : prev))


      // =============================================
      // SUCCESS
      // =============================================
      toast.success(isRejecting ? 'Payment has been rejected successfully.' : 'Payment has been accepted successfully.')
      await loadCustomerOrders()
    } finally {
      setReviewingPayment(false)
    }
  }


  // No order is deleted. One whose down payment never comes, including one
  // whose payment was rejected and never sent again, is cancelled by the
  // database 7 days after its deadline and kept on record (db/migrations/028).


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


  const choices = showChoices(orders)
  // A status no order has any more (e.g. its last one just moved on) shows all.
  const showing = choices.some((choice) => choice.value === show) ? show : ALL
  const shownOrders = sortOrders(filterOrders(orders, showing), sortBy)


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

        <p className="mt-1 text-gray-500">
          {checksPayments ? 'View and manage customer orders.' : 'View customer orders and their payments (view only).'}
        </p>
      </div>


      {/* SHOW AND SORT BY STATUS */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Show
          <select
            value={showing}
            onChange={(event) => setShow(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
          >
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label} ({choice.count})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Sort by
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
          >
            <option value="status">Status (the order's steps, newest first in each)</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>

        {!loading && (
          <p className="pb-2 text-sm text-gray-500">
            Showing {shownOrders.length} of {orders.length} {orders.length === 1 ? 'order' : 'orders'}
          </p>
        )}
      </div>


      {/* TABLE */}
      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">

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
                Estimated Ship Date
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
                <td colSpan="8" className="py-10 text-center text-sm text-gray-500">
                  Loading customer orders...
                </td>
              </tr>

            ) : shownOrders.length > 0 ? (

              shownOrders.map((order) => (
                <tr key={order.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

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
                    ₱ {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>

                  {/* STATUS */}
                  <td className="px-5 py-3">
                    <StatusBadge status={order.status}/>

                    {Number(order.pending_payment_amount || 0) > 0 && (
                      <p className="mt-1 text-xs font-medium text-yellow-700">
                        Payment to verify
                      </p>
                    )}

                    <DownPaymentDeadline order={order} forStaff className="mt-1 max-w-[16rem]" />
                  </td>

                  {/* DATE */}
                  <td className="px-5 py-3">
                    <ShipDateSummary estimate={estimates[order.id]} forStaff />
                  </td>

                  {/* ACTION */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">

                      {/* VIEW ORDER */}
                      <IconButton icon={faFolderOpen} title="View Purchase Order" color="blue" disabled={false} onClick={() => openOrderModal(order)}/>

                      {/* PAYMENT */}
                      {(() => {
                        // A cancelled order shows its payment only if one was ever sent.
                        const noPaymentSent = order.status === 'pending payment'
                          || (order.status === 'cancelled' && !order.payment_proof_dp && !order.payment_proof_complete)
                        return (
                          <IconButton icon={faCreditCard} title={noPaymentSent ? 'Payment Not Yet Available' : 'View Payment'} color="green" disabled={noPaymentSent} onClick={() => openPaymentModal(order)}/>
                        )
                      })()}

                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="8" className="py-10 text-center text-sm text-gray-500">
                  {orders.length > 0 ? 'No orders with this status.' : 'No customer orders found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>


      {showModal && selectedOrder && (
        <CustomerOrderModal
          order={selectedOrder}
          estimate={estimates[selectedOrder.id]}
          onClose={() => {
            setShowModal(false)
            setSelectedOrder(null)
          }}
        />
      )}


      {showPaymentModal && selectedPayment && (
        <PaymentModal
          order={selectedPayment}
          estimate={estimates[selectedPayment.id]}
          onClose={() => {
            setShowPaymentModal(false)
            setSelectedPayment(null)
          }}
          onReview={reviewPayment}
          reviewing={reviewingPayment}
          canCheck={checksPayments}
        />
      )}
    </div>

  )
}







// =====================================================
// VIEW CUSTOMER ORDER MODAL
// =====================================================
function CustomerOrderModal({ order, estimate, onClose }) {
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

          <OrderProgress order={order} forStaff/>



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
              <p className="text-xs uppercase text-gray-500"> Estimated Ship Date </p>
              <div className="mt-1">
                <ShipDateSummary estimate={estimate} forStaff />
              </div>
            </div>
          </div>


          {/* =================================================
              ITEMS
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Customer Order Items
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
          </TableScroll>


          {/* =================================================
              SUMMARY
          ================================================= */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-sm">
          
              <h3 className="mb-4 text-sm font-semibold text-gray-800">
                Payment Summary
              </h3>

              <div className="rounded-lg bg-gray-50 p-4">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Subtotal
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                {order.container_cost != null && (
                  <div className="mb-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-700">
                      Container ({order.container_size})
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(order.container_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping Cost
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.shipping_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                <div className="border-t pt-3 mb-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-amber-700">
                      Remaining Balance
                    </span>

                    <span className="text-lg font-bold text-amber-800">
                      ₱ {Math.max(Number(order.total_amount || 0) -  Number(order.settled_amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="mt-2 flex justify-between">
                    <span className="font-semibold text-green-700">
                      Amount Paid
                    </span>

                    <span className="text-xl font-bold text-green-800">
                      ₱ {Number(order.settled_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
function PaymentModal({ order, estimate, onClose, onReview, reviewing, canCheck = true }) {
  const settledAmount = Number(order.settled_amount || 0)
  const pendingAmount = Number(order.pending_payment_amount || 0)

  // The first payment is reviewed while the order is submitted; a balance
  // payment is reviewed whenever one is waiting, whatever the order's stage.
  const waitingForCheck = order.status === 'submitted' || pendingAmount > 0
  // Only sales and admin approve or reject; management only looks.
  const canReview = canCheck && waitingForCheck


  // =============================================
  // VIEW DOCUMENT
  // =============================================
  async function viewPayment(path, documentName) {
    if (!path) {
      alert(`${documentName} is not available.`);
      return;
    }

    const { data, error } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(path, 60);

    if (error) {
      console.error('Failed to create signed URL:', error);
      alert(`Failed to open ${documentName}.`);
      return;
    }

    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
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
              <p className="text-xs uppercase text-gray-500"> Estimated Ship Date </p>
              <div className="mt-1">
                <ShipDateSummary estimate={estimate} forStaff />
              </div>
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

              <div className="rounded-lg bg-gray-50 grid grid-cols-1 gap-4 md:grid-cols-2 p-4 ">
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
                    Verified Paid
                  </p>

                  <p className="mt-1 font-medium text-gray-800">
                    ₱ {settledAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>

                {/* What the customer says they paid — check it against the proof. */}
                {pendingAmount > 0 && (
                  <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 md:col-span-2">
                    <p className="text-xs font-semibold uppercase text-yellow-700">
                      {canCheck ? 'Awaiting your verification' : 'Awaiting sales\' verification'}
                    </p>

                    <p className="mt-1 text-lg font-bold text-yellow-900">
                      ₱ {pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>

                    <p className="mt-1 text-xs text-yellow-800">
                      {canCheck
                        ? "Open the proof below and approve only if it shows exactly this amount received. Until then it doesn't count as paid."
                        : "Sales checks it against the proof below. Until then it doesn't count as paid."}
                    </p>
                  </div>
                )}

                <div className="mt-3">
                  <p className="text-xs uppercase text-gray-500">
                    Payment Proof
                  </p>

                  <div className="mt-2 flex gap-2">

                    {/* DOWN PAYMENT PROOF */}
                    {order.payment_proof_dp && (
                      <button
                        type="button"
                        onClick={() => viewPayment(order.payment_proof_dp, "Down Payment Proof")}
                        className="inline-flex rounded-lg border border-blue-200 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        View Down Payment Proof
                      </button>
                    )}

                    {/* COMPLETE PAYMENT PROOF */}
                    {order.payment_proof_complete && (
                      <button
                        type="button"
                        onClick={() => viewPayment(order.payment_proof_complete, "Complete Payment Proof")}
                        className="inline-flex rounded-lg border border-green-200 bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                      >
                        View Complete Payment Proof
                      </button>
                    )}

                    {/* NO PROOF */}
                    {!order.payment_proof_dp && !order.payment_proof_complete && (
                      <p className="text-sm text-gray-400">
                        No payment proof uploaded.
                      </p>
                    )}

                  </div>
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
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Subtotal
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                {order.container_cost != null && (
                  <div className="mb-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-700">
                      Container ({order.container_size})
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(order.container_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping Cost
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.shipping_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                <div className="border-t pt-3 mb-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-amber-700">
                      Remaining Balance
                    </span>

                    <span className="text-lg font-bold text-amber-800">
                      ₱ {Math.max(Number(order.total_amount || 0) -  Number(order.settled_amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>


                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-green-700">
                      Amount Paid
                    </span>

                    <span className="text-xl font-bold text-green-800">
                      ₱ {Number(order.settled_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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

          {waitingForCheck && !canCheck && (
            <p className="order-first mr-auto text-sm text-gray-500">View only: sales approves or rejects payments.</p>
          )}

          {canReview && (
            <>
              <button
                type="button"
                onClick={() => onReview(order, false)}
                disabled={reviewing}
                className="flex items-center gap-2 rounded-md border border-red-600 bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faCircleXmark} />
                Reject Payment
              </button>

              <button
                type="button"
                onClick={() => onReview(order, true)}
                disabled={reviewing}
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