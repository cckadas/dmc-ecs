'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'


export default function PaymentsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [payments, setPayments] = useState([])
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)


  // =============================================
  // LOAD CUSTOMER PAYMENTS
  // =============================================
  async function loadPayments() {

    if (!profile?.id) return

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
            brand
          )
        )
      `)
      .eq('customer_id', profile.id)
      .in('status', [
        'pending payment',
        'submitted',
        'payment rejected',
        'payment verified'
      ])
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Failed to load payments.')
      setLoading(false)
      return
    }

    const priority = {
      'pending payment': 1,
      'submitted': 2,
      'payment verified': 3,
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


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Payments
        </h1>

        <p className="text-gray-500">
          View and settle your customer order payments.
        </p>
      </div>


      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">

          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Order Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Quotation
              </th>

              <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                Amount Due
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


          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-gray-500">
                  Loading payments...
                </td>
              </tr>
            ) : payments.length > 0 ? (
              payments.map((payment) => {
                const isPending = payment.status === 'pending payment'
                const isSubmitted = payment.status === 'submitted'
                const isRejected = payment.status === 'payment rejected'
                const isVerified = payment.status === 'payment verified'

                return (
                  <tr key={payment.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

                    {/* ORDER NUMBER */}
                    <td className="px-5 py-3 font-medium text-gray-800">
                      {payment.order_number || '-'}
                    </td>


                    {/* QUOTATION */}
                    <td className="px-5 py-3">
                      {payment.quotation_number || '-'}
                    </td>


                    {/* AMOUNT DUE */}
                    <td className="px-5 py-3 text-right font-medium">
                      ₱{' '}

                      {Number(
                        payment.down_payment_amount || 0
                      ).toLocaleString(
                        undefined,
                        {
                          minimumFractionDigits: 2,
                        }
                      )}
                    </td>


                    {/* STATUS */}
                    <td className="px-5 py-3">
                      <StatusBadge status={payment.status}/>
                    </td>


                    {/* DATE */}
                    <td className="px-5 py-3">
                      {new Date(payment.created_at).toLocaleDateString()}
                    </td>


                    {/* ACTION */}
                    <td className="px-5 py-3">
                      {isPending ? (
                        <IconButton icon={faEye} title="View Payment" color="blue" disabled={false} onClick={() => openPaymentModal(payment)}/>
                      ) : isSubmitted ? (
                        <span className="text-sm font-medium text-yellow-600">
                          Awaiting payment verification
                        </span> 
                       ) : isRejected ? (
                        <span className="text-sm font-medium text-red-600">
                          Contact admin to settle payment
                        </span>                      
                      ) : isVerified ? (
                        <span className="text-sm font-medium text-green-600">
                          Payment already verified
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-gray-500">
                  No payments found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


      {showModal && selectedPayment && (
        <PaymentModal 
          payment={selectedPayment} 
          onClose={() => { 
            setShowModal(false) 
            setSelectedPayment(null) 
          }}
          onPaymentSubmitted={() => { 
            loadPayments()
            toast.success('Payment successful')
          }}
        />
      )}

    </div>
  )
}







// =====================================================
// PAYMENT MODAL
// =====================================================
function PaymentModal({ payment, onClose, onPaymentSubmitted }) {
  const amountDue = Number(payment.down_payment_amount || 0)

  const [selectedBank, setSelectedBank] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentFile, setPaymentFile] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function confirmPayment() {
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

    if (amount > amountDue) {
      alert('The amount paid cannot exceed the amount due.')
      return
    }

    setIsSubmitting(true)

    try {

      // =============================================
      // UPLOAD PAYMENT PROOF
      // =============================================
      const fileExtension = paymentFile.name.split('.').pop()
      const fileName = `${payment.id}-${Date.now()}.${fileExtension}`
      const filePath = `payments/${fileName}`

      const { error: uploadError } = await supabase
        .storage
        .from('payment-proofs')
        .upload(filePath, paymentFile, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error(uploadError)
        alert('Failed to upload payment confirmation.')
        return
      }


      // =============================================
      // SAVE PAYMENT INFORMATION
      // =============================================
      const { error: updateError } = await supabase
        .from('customer_orders')
        .update({
          settled_amount: amount,
          payment_bank: selectedBank,
          payment_proof: filePath,
          status: 'submitted',
        })
        .eq('id', payment.id)

      if (updateError) {
        console.error(updateError)

        // Remove uploaded file if database update failed
        await supabase
          .storage
          .from('payment-proofs')
          .remove([filePath])

        alert('Failed to save payment information.')
        return
      }


      // =============================================
      // SUCCESS
      // =============================================
      await onPaymentSubmitted()
      onClose()
    }
    
    catch (error) {
      console.error(error)
      alert('Something went wrong while submitting the payment.')
    }
    
    finally {
      setIsSubmitting(false)
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
              {payment.order_number || '-'}
            </h2>

            <p className="text-sm text-gray-500">
              Payment
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
            Order Information
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Order Number </p>
              <p className="mt-1 font-medium text-gray-800"> {payment.order_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Quotation Number </p>
              <p className="mt-1 font-medium text-gray-800"> {payment.quotation_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <p className="mt-1 font-medium text-gray-800"> <StatusBadge status={payment.status}/> </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Date </p>
              <p className="mt-1 font-medium text-gray-800"> {new Date(payment.created_at).toLocaleDateString()} </p>
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
                            {item.product_name}
                          </p>

                          {item.brand && (
                            <p className="text-xs text-gray-500">
                              {item.brand}
                            </p>
                          )}
                        </td>


                        {/* QUANTITY */}
                        <td className="px-4 py-4 text-left">
                          {item.quantity}
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
                    ) 
                  ) 
                ) : (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-sm text-gray-500">
                      No order items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>




          

          <div className="mt-6 mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">

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
                    ₱ {Number(payment.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(payment.shipping_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>


                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-xl font-bold text-gray-800">
                      ₱ {Number(payment.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-green-700">
                      Amount Due
                    </span>

                    <span className="text-lg font-bold text-green-800">
                      ₱ {amountDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>            
            </div>


            {/* =====================================================
                MAKE PAYMENT
            ===================================================== */}
            <div className="md:col-span-3">
              <h3 className="mb-4 text-sm font-semibold text-gray-800">
                Make Payment
              </h3>

              <div className="rounded-lg bg-gray-50 p-4">

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
                        className={`rounded-full border px-4 py-2 text-sm font-medium transition
                          ${
                            selectedBank === bank
                              ? 'border-[#1F3A2C] bg-[#1F3A2C] text-white'
                              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                          }
                        `}
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
                      step="01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-8 pr-3 text-right outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
                    />
                  </div>
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
                      onChange={(e) => {
                        setPaymentFile(e.target.files?.[0] || null)
                      }}
                      className="hidden"
                    />
                  </label>
                </div>


                {/* CONFIRM PAYMENT */}
                <button
                  type="button"
                  onClick={confirmPayment}
                  disabled={ isSubmitting || !selectedBank || !paymentAmount || !paymentFile }
                  className="w-full rounded-lg bg-[#1F3A2C] px-4 py-2.5 font-medium text-white hover:bg-[#2D5A42] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting Payment...' : 'Confirm Payment'}
                </button>

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
        </div>


      </div>
    </div>
  )
}