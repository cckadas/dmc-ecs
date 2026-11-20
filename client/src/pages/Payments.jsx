'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCreditCard, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"
import { createNotification } from '../services/notificationService'
import { recordStatusChange } from '../services/predictionService'

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'
import TableScroll from '../components/TableScroll'
import { CANCELLATION_COLUMNS, columnsIf, withNewColumns } from '../utils/newColumns'
import DownPaymentDeadline from '../components/DownPaymentDeadline'
import { deadlineNote } from '../utils/deadlineNote'
import { downPaymentDates, downPaymentStatus, formatDay } from '../utils/paymentDeadline'
import ListControls from '../components/ListControls'
import { dateTime, day, exportList, money, productsText, statusText } from '../utils/csvExport'
import { ALL, applySearch, applyShow, applySort, byNewest, byOldest, byStatus, bySoonest, showChoices, showingOf } from '../utils/listControls'


// Where each order stands with paying, for Show.
const PAYMENT_GROUPS = [
  { value: 'to pay', label: 'Down payment to pay', test: (order) => ['due', 'due soon', 'due today', 'overdue', 'closed'].includes(downPaymentStatus(order).state) },
  { value: 'checking', label: 'Awaiting DMC\'s check', test: (order) => downPaymentStatus(order).state === 'checking' || Number(order.pending_payment_amount || 0) > 0 },
  { value: 'balance', label: 'Balance to pay', test: (order) => Number(order.settled_amount || 0) > 0 && Number(order.pending_payment_amount || 0) <= 0 && Number(order.total_amount || 0) - Number(order.settled_amount || 0) > 0.009 && String(order.status).toLowerCase() !== 'cancelled' },
  { value: 'paid', label: 'Fully paid', test: (order) => Number(order.total_amount || 0) > 0 && Number(order.settled_amount || 0) >= Number(order.total_amount || 0) },
  { value: 'cancelled', label: 'Cancelled', test: (order) => String(order.status).toLowerCase() === 'cancelled' },
]

// The same order as before: what needs paying first.
const PAYMENT_STATUS_ORDER = ['pending payment', 'submitted', 'payment verified', 'payment rejected', 'procurement', 'warehouse preparation', 'ready for shipment', 'partly shipped', 'shipped', 'cancelled']


export default function PaymentsPage() {

  const { profile } = useAuth()
  const { toast } = useToast()

  const [payments, setPayments] = useState([])
  // Show (where each stands with paying), Sort by and Search, above the list.
  const [show, setShow] = useState(ALL)
  const [sortBy, setSortBy] = useState('status')
  const [search, setSearch] = useState('')
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)


  // =============================================
  // LOAD CUSTOMER PAYMENTS
  // =============================================
  async function loadPayments() {

    if (!profile?.id) return

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
        total_amount,
        down_payment_amount,
        status,
        settled_amount,
        pending_payment_amount,
        payment_bank,
        payment_proof_dp,
        payment_proof_complete,
        expiry_date,
        ${columnsIf(withCancellation, CANCELLATION_COLUMNS)}
        rejection_reason,
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
      .eq('customer_id', profile.id)
      // Every stage: an unpaid balance counts toward the credit limit until
      // it is paid, so the customer must be able to pay it at any point.
      // Cancelled orders are listed too, with when and why.
      .in('status', [
        'pending payment',
        'submitted',
        'payment rejected',
        'payment verified',
        'procurement',
        'warehouse preparation',
        'ready for shipment',
        'partly shipped',
        'shipped',
        'cancelled'
      ])
      .order('created_at', { ascending: false }), CANCELLATION_COLUMNS)

    if (error) {
      console.error(error)
      toast.error('Failed to load payments.')
      setLoading(false)
      return
    }

    const priority = {
      'pending payment': 1,
      'submitted': 2,
      'payment verified': 3,
      'payment rejected': 4,
      'procurement': 5,
      'warehouse preparation': 6,
      'ready for shipment': 7,
      'partly shipped': 8,
      'shipped': 8,
      'cancelled': 9,
    }

    const sortedPayments = (data || []).sort((a, b) => {

      const aPriority = priority[a.status] || 99
      const bPriority = priority[b.status] || 99

      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }

      return new Date(b.created_at) - new Date(a.created_at)
    })

    setPayments(sortedPayments)
    setLoading(false)
  }


  // =============================================
  // OPEN PAYMENT MODAL
  // =============================================
  function openPaymentModal(payment) {
    setSelectedPayment(payment)
    setShowModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadPayments()
    }
  }, [profile?.id])


  // The list as chosen above it.
  const paymentList = { statusOf: (order) => order.status, groups: PAYMENT_GROUPS, includeStatuses: false }
  const choices = showChoices(payments, paymentList)
  const showing = showingOf(choices, show)
  const shownPayments = applySort(
    applySearch(applyShow(payments, showing, paymentList), search, (order) => [order.order_number, order.quotation_number].join(' ')),
    sortBy,
    {
      status: byStatus((order) => order.status, PAYMENT_STATUS_ORDER, (order) => order.created_at),
      // A down payment still to pay, by its deadline; then everything else.
      due: bySoonest((order) => (PAYMENT_GROUPS[0].test(order) ? downPaymentStatus(order).deadline : null)),
      newest: byNewest((order) => order.created_at),
      oldest: byOldest((order) => order.created_at),
    }
  )


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* =============================================
          HEADER
      ============================================= */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Payments
        </h1>

        <p className="mt-1 text-gray-500">
          View and settle your customer order payments.
        </p>
      </div>


      <ListControls
        choices={choices}
        show={showing}
        onShow={setShow}
        sorts={[
          { value: 'status', label: 'Status (what needs paying first)' },
          { value: 'due', label: 'Due date (soonest first)' },
          { value: 'newest', label: 'Newest first' },
          { value: 'oldest', label: 'Oldest first' },
        ]}
        sortBy={sortBy}
        onSort={setSortBy}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Order or quotation number"
        shown={shownPayments.length}
        total={payments.length}
        onExport={(how) => exportList(how, 'payments', PAYMENT_COLUMNS, shownPayments)}
        noun={payments.length === 1 ? 'order' : 'orders'}
        loading={loading}
      />


      {/* =============================================
          TABLE
      ============================================= */}
      <div className="overflow-clip rounded-xl border border-gray-200 bg-white shadow-sm">
        <TableScroll>
          <table className="min-w-full">

            <thead className="bg-[#F4F8F5]">
              <tr>

                {/* ORDER NUMBER */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Order Number
                </th>

                {/* QUOTATION */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Quotation
                </th>

                {/* TOTAL */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Total Amount
                </th>

                {/* SETTLED */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Settled
                </th>

                {/* REMAINING BALANCE */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Remaining Balance
                </th>

                {/* STATUS */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Status
                </th>

                {/* DUE DATE */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Due Date
                </th>

                {/* ACTION */}
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Action
                </th>

              </tr>
            </thead>

            <tbody>
              {loading ? (

                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-gray-500">
                    Loading payments...
                  </td>
                </tr>

              ) : shownPayments.length > 0 ? (

                shownPayments.map((payment) => {
  
                  const isPending = payment.status === 'pending payment'
                  const isSubmitted = payment.status === 'submitted'
                  const isRejected = payment.status === 'payment rejected'
                  const isVerified = payment.status === 'payment verified'
                  const isProcurement = payment.status === 'procurement'
                  const isLaterStage = ['warehouse preparation', 'ready for shipment', 'partly shipped', 'shipped'].includes(payment.status)
                  const canPayBalance = isVerified || isProcurement || isLaterStage

                  // settled_amount = payments sales has verified; a submitted
                  // payment waits in pending_payment_amount until then.
                  const totalAmount = Number(payment.total_amount || 0)
                  const settledAmount = Number(payment.settled_amount || 0)
                  const pendingAmount = Number(payment.pending_payment_amount || 0)
                  const remainingBalance = Math.max(totalAmount - settledAmount, 0)

                  // The down payment's deadline (db/migrations/028): after it, 7
                  // more days to pay; after those the order is cancelled.
                  const deadline = downPaymentStatus(payment)
                  const tooLate = ['closed', 'cancelled'].includes(deadline.state)


                  return (
                    <tr key={payment.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

                      {/* ORDER NUMBER */}
                      <td className="px-5 py-3">
                        {payment.order_number || '-'}
                      </td>

                      {/* QUOTATION */}
                      <td className="px-5 py-3">
                        {payment.quotation_number || '-'}
                      </td>

                      {/* TOTAL AMOUNT */}
                      <td className="px-5 py-3">
                        ₱ {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>

                      {/* SETTLED */}
                      <td className="px-5 py-3">
                        ₱ {settledAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}

                        {pendingAmount > 0 && (
                          <p className="text-xs text-yellow-700">
                            + ₱ {pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} awaiting verification
                          </p>
                        )}
                      </td>

                      {/* REMAINING BALANCE */}
                      {/* A cancelled order owes nothing (it no longer counts toward the credit limit). */}
                      <td className="px-5 py-3">
                        {tooLate && deadline.state === 'cancelled' ? (
                          <span className="text-sm text-gray-400">
                            None (cancelled)
                          </span>
                        ) : remainingBalance > 0 ? (
                          <span className="font-semibold text-amber-700">
                            ₱ {remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="font-semibold text-green-700">
                            ₱ 0.00
                          </span>
                        )}
                      </td>

                      {/* STATUS */}
                      <td className="px-5 py-3">
                        <StatusBadge status={payment.status}/>
                      </td>

                      {/* DUE DATE */}
                      <td className="px-5 py-3">
                        {/* The down payment's deadline; none once it's paid (the balance has none). */}
                        {deadline.deadline && deadline.state !== 'paid' ? (
                          <span className={`inline-flex items-center rounded-md border px-2.5 py-1 font-semibold ${
                            ['due soon', 'due today', 'overdue', 'closed'].includes(deadline.state)
                              ? 'border-red-200 bg-red-50 text-red-800'
                              : ['cancelled', 'checking'].includes(deadline.state)
                                ? 'border-gray-200 bg-gray-50 text-gray-600'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                          }`}>
                            {formatDay(deadline.deadline)}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>

                      {/* ACTION */}
                      <td className="px-5 py-3">
                        {/* Past the deadline: the last day to pay and the day it's
                            cancelled; or when and why it was cancelled. */}
                        {['due today', 'overdue', 'closed', 'cancelled'].includes(deadline.state) && (
                          <DownPaymentDeadline order={payment} className="mb-1 max-w-[18rem]" />
                        )}

                        {tooLate ? (

                          <span className="text-sm text-gray-400">
                            Can no longer be paid
                          </span>

                        ) : isSubmitted || pendingAmount > 0 ? (

                          <span className="text-sm font-medium text-yellow-600">
                            Awaiting payment verification
                          </span>

                        ) : isPending && remainingBalance > 0 ? (

                          <IconButton icon={faCreditCard} title="Make Payment" color="green" disabled={false} onClick={() => openPaymentModal(payment) }/>

                        ) : isRejected ? (

                          <IconButton icon={faCreditCard} title="Make Payment" color="green" disabled={false} onClick={() => openPaymentModal(payment) }/>

                        ) : canPayBalance && remainingBalance > 0 ? (

                          <IconButton icon={faCreditCard} title="Pay Remaining Balance" color="green" disabled={false} onClick={() => openPaymentModal(payment)}/>

                        ) : canPayBalance && remainingBalance <= 0 ? (

                          <span className="text-sm font-medium text-green-600">
                            Payment fully settled
                          </span>

                        ) : (

                          <span className="text-sm text-gray-400">
                            -
                          </span>

                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-gray-500">
                    {payments.length > 0 ? 'Nothing matches what is chosen above.' : 'No payments found.'}
                  </td>
                </tr>
              )}
            </tbody>

          </table>
        </TableScroll>
      </div>


      {showModal && selectedPayment && (
        <PaymentModal
          payment={selectedPayment}
          onClose={() => {
            setShowModal(false)
            setSelectedPayment(null)
          }}
          onPaymentSubmitted={async () => {
            await loadPayments()
            toast.success('Payment submitted successfully.')
          }}
          onRefused={loadPayments}
        />
      )}

    </div>
  )
}





// =====================================================
// PAYMENT MODAL
// =====================================================
function PaymentModal({ payment, onClose, onPaymentSubmitted, onRefused }) {

  const totalAmountDue = Number(payment.total_amount || 0)
  const currentSettledAmount = Number(payment.settled_amount || 0)
  const pendingAmount = Number(payment.pending_payment_amount || 0)
  const remainingBalance = Math.max(totalAmountDue - currentSettledAmount, 0)
  const downPaymentAmount = Number(payment.down_payment_amount || 0)

  // Two payments per order, each checked by sales: the down payment (at
  // least 50%), then the full remaining balance.
  const isFirstPayment = currentSettledAmount <= 0

  // The down payment's deadline (db/migrations/028). The balance has none.
  const deadline = downPaymentStatus(payment)
  const deadlineWords = deadlineNote(payment)
  const isExpiringSoon = ['due soon', 'due today', 'overdue', 'closed'].includes(deadline.state)

  // Too late for the down payment: the order is being cancelled. The database
  // refuses it too, even if this page was opened before.
  const tooLateMessage = !isFirstPayment ? null
    : deadline.state === 'cancelled'
      ? `${payment.order_number} was cancelled, so it can't be paid any more. To order these products, please send a new quotation request.`
      : deadline.state === 'closed'
        ? `The last day to pay the down payment for ${payment.order_number} was ${formatDay(deadline.lastDay)}, so it can't be paid any more and the order is being cancelled. To order these products, please send a new quotation request.`
        : null

  const [selectedBank, setSelectedBank] = useState(payment.payment_bank || '')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentFile, setPaymentFile] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)



  // =====================================================
  // PAYMENT CONFIRMATION
  // =====================================================
  async function confirmPayment() {

    if (tooLateMessage) {
      alert(tooLateMessage)
      return
    }

    if (!selectedBank) {
      alert('Please select a bank.')
      return
    }

    if (!paymentAmount || Number(paymentAmount) <= 0) {
      alert('Please enter the amount paid.')
      return
    }

    if (!paymentFile) {
      alert('Please upload your payment confirmation.')
      return
    }

    const amount = Number(paymentAmount)


    // =============================================
    // PREVENT PAYMENT ABOVE REMAINING BALANCE
    // =============================================
    if (amount > remainingBalance) {
      alert(`The amount paid cannot exceed the remaining balance of ₱ ${remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}.`)
      return
    }

    // =============================================
    // ONE PAYMENT UNDER REVIEW AT A TIME
    // =============================================
    if (pendingAmount > 0) {
      alert('A payment for this order is still waiting for verification by DMC.')
      return
    }

    // =============================================
    // PREVENT PAYMENT BELOW AMOUNT DUE
    // The first payment must cover the down payment; the second must be the
    // whole remaining balance. (Checking the down payment on the second
    // payment too meant a customer who paid more than 50% up front could
    // never pay a balance smaller than the down payment.)
    // =============================================
    if (isFirstPayment && amount < downPaymentAmount) {
      alert(`The amount paid cannot go lower than the amount due of ₱ ${downPaymentAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}.`)
      return
    }

    // Compared in centavos so 6,600 - 0.000001 rounding doesn't count as short.
    if (!isFirstPayment && Math.round(amount * 100) !== Math.round(remainingBalance * 100)) {
      alert(`Please pay the full remaining balance of ₱ ${remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}.`)
      return
    }

    // =============================================
    // PREVENT PAYMENT IF ALREADY FULLY PAID
    // =============================================
    if (remainingBalance <= 0) {
      alert('This customer order has already been fully paid.')
      return
    }

    setIsSubmitting(true)

    try {

      const isFullyPaid = currentSettledAmount + amount >= totalAmountDue

      const paymentProofColumn = isFullyPaid ? 'payment_proof_complete' : 'payment_proof_dp'


      // =============================================
      // UPLOAD PAYMENT PROOF
      // =============================================
      const fileExtension = paymentFile.name.split('.').pop()
      const fileName = `${payment.id}-${Date.now()}.${fileExtension}`
      const filePath = `payments/${fileName}`

      const { error: uploadError } = await supabase
        .storage
        .from('payment-proofs')
        .upload(
          filePath,
          paymentFile,
          {
            cacheControl: '3600',
            upsert: false,
          }
        )

      if (uploadError) {
        console.error(uploadError)
        alert('Failed to upload payment confirmation.')
        return
      }


      // =============================================
      // SAVE PAYMENT INFORMATION
      // =============================================
      // The amount waits for sales to check it against the proof. Only then
      // does it count as paid (settled_amount) and lower the customer's debt.
      const updateData = {
        pending_payment_amount: amount,
        payment_bank:selectedBank,
        [paymentProofColumn]:filePath,
      }


      // =============================================
      // ONLY CHANGE STATUS FOR INITIAL PAYMENT
      // =============================================
      if (isFirstPayment) {
        updateData.status = 'submitted'
      }


      const { error: updateError } = await supabase
        .from('customer_orders')
        .update(updateData)
        .eq('id', payment.id)

      if (updateError) {
        console.error(updateError)

        // =============================================
        // REMOVE UPLOADED FILE IF DB UPDATE FAILED
        // =============================================
        await supabase
          .storage
          .from('payment-proofs')
          .remove([
            filePath
          ])

        // A rule's own words, e.g. the last day to pay has passed.
        if (updateError.code === 'P0001' && updateError.message) {
          alert(updateError.message)
          await onRefused?.()
          onClose()
          return
        }

        alert('Failed to save payment information.')
        return
      }


      if (isFirstPayment) {
        await recordStatusChange(payment.id, payment.status, 'submitted')
      }


      // =============================================
      // SUCCESS
      // =============================================
      await createNotification({
        userId: payment.customer_id,
        role: 'sales',
        title: `${payment.order_number} - Payment needs verification`,
        message: `A payment of ₱${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} for order ${payment.order_number} was submitted. Check it against the proof before approving.`,
        type: 'info',
        relatedCustomerOrderId: payment.id,
        link: '/customer-orders',
      })

      await onPaymentSubmitted()
      onClose()
    }

    catch (error) {
      console.error('Failed to submit payment:', error)
      alert('Something went wrong while submitting the payment.')
    }

    finally {
      setIsSubmitting(false)
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">


        {/* =============================================
            HEADER
        ============================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {payment.order_number || '-'}
            </h2>

            <p className="text-sm text-gray-500">
              Payment
            </p>
          </div>


          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
          >
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>


        {/* =============================================
            CONTENT
        ============================================= */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* =============================================
              ORDER INFORMATION
          ============================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Order Information
          </h3>

          <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-5">

            {/* ORDER NUMBER */}
            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500">
                Order Number
              </p>

              <p className="mt-1 font-medium text-gray-800">
                {payment.order_number || '-'}
              </p>
            </div>

            {/* QUOTATION */}
            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500">
                Quotation Number
              </p>

              <p className="mt-1 font-medium text-gray-800">
                {payment.quotation_number || '-'}
              </p>
            </div>

            {/* STATUS */}
            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500">
                Status
              </p>

              <div className="mt-1">
                <StatusBadge status={payment.status}/>
              </div>
            </div>

            {/* TOTAL */}
            <div className="flex flex-col justify-center">
              <p className="text-xs uppercase text-gray-500">
                Total Amount
              </p>

              <p className="mt-1 font-semibold text-gray-800">
                ₱ {totalAmountDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>

            {/* DUE DATE */}
            <div className={`flex flex-col justify-center rounded-md border p-2 ${deadline.state === 'paid' ? 'border-gray-200 bg-gray-50' : isExpiringSoon ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className={`text-xs font-semibold uppercase ${isExpiringSoon ? 'text-red-600' : 'text-amber-600'}`}>
                Due Date
              </p>

              <p className={`mt-1 font-semibold ${deadline.state === 'paid' ? 'text-gray-600' : isExpiringSoon ? 'text-red-800' : 'text-amber-800'}`}>
                {deadline.state === 'paid' ? 'Down payment received' : deadline.deadline ? formatDay(deadline.deadline) : '-'}
              </p>

              {deadline.state === 'paid' ? (
                <p className="mt-1 text-xs text-gray-500">The balance has no deadline.</p>
              ) : ['due today', 'overdue', 'closed', 'cancelled'].includes(deadline.state) && deadlineWords ? (
                <p className="mt-1 text-xs font-medium text-red-700">{deadlineWords.text}</p>
              ) : null}
            </div>
          </div>


          {/* ================================================= 
              PAYMENT REJECTION NOTICE
          ================================================= */}
          {/* A rejected balance payment leaves the order's status alone, so
              its reason shows here too. Approval clears the reason. */}
          {(payment.status === 'payment rejected' || (!isFirstPayment && payment.rejection_reason)) && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-800">
                Payment Rejected
              </p>

              <p className="mt-1 text-sm text-red-700">
                Please review the rejection reason and contact the DMC administrator or sales representative for assistance if you have any questions or clarification.
              </p>

              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
                  Rejection Reason
                </p>

                <p className="mt-1 text-sm text-red-800">
                  {payment.rejection_reason || 'No rejection reason was provided.'}
                </p>
              </div>
            </div>
          )}


          {/* =============================================
              ITEMS
          ============================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800 mt-6">
            Customer Order Items
          </h3>

          <TableScroll className="rounded-lg border">
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
                {payment.customer_order_items?.length > 0 ? (
                  payment.customer_order_items.map(
                    (item) => (
                      <tr key={item.id} className="border-t border-gray-200">

                        {/* PRODUCT */}
                        <td className="px-4 py-4">
                          <p className="font-medium text-gray-800">
                            {item.products?.product_name || '-'}
                          </p>

                          {item.products?.brand && (
                            <p className="text-xs text-gray-500">
                              {item.products.brand}
                            </p>
                          )}
                        </td>

                        {/* QUANTITY */}
                        <td className="px-4 py-4 text-left">
                          {item.quantity}
                        </td>

                        {/* UNIT */}
                        <td className="px-4 py-4 text-left">
                          {item.products?.unit || '-'}
                        </td>

                        {/* UNIT PRICE */}
                        <td className="px-4 py-4 text-left">
                          ₱ {Number(item.unit_price || 0).toLocaleString( undefined, { minimumFractionDigits: 2})}
                        </td>

                        {/* SUBTOTAL */}
                        <td className="px-4 py-4 text-left">
                          ₱ {Number(item.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )
                  )
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-gray-500">
                      No order items found.
                    </td>
                  </tr>
                )}
              </tbody>

            </table>
          </TableScroll>


          {/* =============================================
              PAYMENT SUMMARY + MAKE PAYMENT
          ============================================= */}
          <div className="mt-6 mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">


            {/* =============================================
                PAYMENT SUMMARY
            ============================================= */}
            <div className="md:col-span-2">
              <h3 className="mb-4 text-sm font-semibold text-gray-800">
                Payment Summary
              </h3>

              <div className="rounded-lg bg-gray-50 p-4">

                {/* SUBTOTAL */}
                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Subtotal
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(payment.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* CONTAINER */}
                {payment.container_cost != null && (
                  <div className="mb-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-700">
                      Container ({payment.container_size})
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(payment.container_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                {/* SHIPPING */}
                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(payment.shipping_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* TOTAL */}
                <div className="border-t pt-3">-

                  {/* TOTAL */}
                  <div className="mb-2 flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-xl font-bold text-gray-800">
                      ₱ {totalAmountDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* AMOUNT DUE */}
                  <div className="mb-2 flex justify-between">
                    <span className="font-semibold text-blue-700">
                      Amount Due
                    </span>

                    <span className="text-lg font-bold text-blue-800">
                      ₱ {downPaymentAmount.toLocaleString( undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* SETTLED */}
                  <div className="mb-2 flex justify-between">
                    <span className="font-semibold text-green-700">
                      Settled
                    </span>

                    <span className="text-lg font-bold text-green-800">
                      ₱ {currentSettledAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>


                  {/* REMAINING */}
                  <div className="flex justify-between">
                    <span className="font-semibold text-amber-700">
                      Remaining Balance
                    </span>

                    <span className="text-lg font-bold text-amber-800">
                      ₱ {remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>


            {/* =============================================
                MAKE PAYMENT
            ============================================= */}
            <div className="md:col-span-3">
              <h3 className="mb-4 text-sm font-semibold text-gray-800">
                Make Payment
              </h3>

              {remainingBalance > 0 ? (
                <div className="rounded-lg bg-gray-50 p-4">

                  {/* REMAINING BALANCE NOTICE */}
                  <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase text-amber-700">
                      Amount Remaining
                    </p>

                    <p className="mt-1 text-xl font-bold text-amber-800">
                      ₱ {remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  {/* BANK */}
                  <div className="mb-5">
                    <p className="mb-2 text-sm font-medium text-gray-700">
                      Select Bank
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {['BDO', 'Chinabank', 'Other'].map((bank) => (
                        <button
                          key={bank}
                          type="button"
                          onClick={() => setSelectedBank(bank)}
                          className={`rounded-full border px-4 py-2 text-sm font-medium transition ${selectedBank === bank ? 'border-[#1F3A2C] bg-[#1F3A2C] text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}
                        >
                          {bank}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AMOUNT */}
                  <div className="mb-5">
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Amount Paid
                    </label>

                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                        ₱
                      </span>

                      <input
                        type="number"
                        min="0"
                        max={remainingBalance}
                        step="0.01"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-8 pr-3 text-right outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
                      />
                    </div>

                    <p className="mt-1 text-xs text-gray-400">
                      {isFirstPayment
                        ? `Down payment: at least ₱ ${downPaymentAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}, up to ₱ ${remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : `Balance payment: exactly ₱ ${remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      DMC checks the amount against your proof before it counts as paid.
                    </p>
                  </div>

                  {/* UPLOAD */}
                  <div className="mb-5">
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Payment Confirmation
                    </label>

                    <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center transition hover:border-[#1F3A2C] hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          {paymentFile ? paymentFile.name : 'Upload payment confirmation'}
                        </p>

                        <p className="mt-1 text-xs text-gray-400">
                          Image or PDF
                        </p>
                      </div>

                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => { setPaymentFile( e.target.files?.[0] || null) }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* CONFIRM PAYMENT */}
                  <button
                    type="button"
                    onClick={confirmPayment}
                    disabled={isSubmitting || !selectedBank || !paymentAmount || !paymentFile || remainingBalance <= 0}
                    className="w-full rounded-lg bg-[#1F3A2C] px-4 py-2.5 font-medium text-white hover:bg-[#2D5A42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? 'Submitting Payment...' : 'Confirm Payment'}
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
                  <p className="font-semibold text-green-800">
                    Payment Fully Settled
                  </p>

                  <p className="mt-1 text-sm text-green-700">
                    This customer order has no remaining balance.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* =============================================
            FOOTER
        ============================================= */}
        <div className="flex items-center justify-end gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per order, as listed.
// =============================================
const isCancelledOrder = (order) => String(order.status || '').trim().toLowerCase() === 'cancelled'
const PAYMENT_COLUMNS = [
  { header: 'Order', value: (order) => order.order_number },
  { header: 'Quotation', value: (order) => order.quotation_number },
  { header: 'Status', value: (order) => statusText(order.status) },
  { header: 'Total (PHP)', value: (order) => money(order.total_amount) },
  { header: 'Down payment (PHP)', value: (order) => money(order.down_payment_amount) },
  { header: 'Paid and verified (PHP)', value: (order) => money(order.settled_amount) },
  { header: 'Waiting for DMC to check (PHP)', value: (order) => money(order.pending_payment_amount) },
  { header: 'Balance (PHP)', value: (order) => (isCancelledOrder(order) ? 0 : money(Math.max(Number(order.total_amount || 0) - Number(order.settled_amount || 0), 0))) },
  { header: 'Down payment due by', value: (order) => (Number(order.settled_amount || 0) > 0 || isCancelledOrder(order) ? '' : day(downPaymentDates(order)?.deadline)) },
  { header: 'Cancelled', value: (order) => dateTime(order.cancelled_at) },
  { header: 'Placed', value: (order) => dateTime(order.created_at) },
  { header: 'Products', value: (order) => productsText(order.customer_order_items) },
]
