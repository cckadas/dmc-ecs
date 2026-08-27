'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { faFileInvoice } from '@fortawesome/free-solid-svg-icons'

import StatusBadge from '../components/StatusBadge'
import IconButton from '../components/IconButton'


export default function BillingsPage() {

  const { toast } = useToast()

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)


  // =====================================================
  // LOAD CUSTOMER ORDERS
  // =====================================================
  async function loadCustomerOrders() {

    setLoading(true)

    try {

      const { data, error } = await supabase
        .from('customer_orders')
        .select(`
          id,
          order_number,
          customer_id,
          quotation_number,
          total_amount,
          down_payment_amount,
          settled_amount,
          status,
          payment_proof_dp,
          payment_proof_complete,
          created_at
        `)
        .order('created_at', {
          ascending: false
        })

      if (error) {
        throw error
      }

      if (!data || data.length === 0) {
        setOrders([])
        return
      }


      // =================================================
      // GET CUSTOMER IDS
      // =================================================
      const customerIds = [
        ...new Set(
          data
            .map((order) => order.customer_id)
            .filter(Boolean)
        )
      ]


      // =================================================
      // LOAD CUSTOMER PROFILES
      // =================================================
      let profilesMap = {}

      if (customerIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select(`
            id,
            name,
            email,
            company
          `)
          .in('id', customerIds)


        if (profilesError) {
          throw profilesError
        }

        profilesMap = (profiles || []).reduce(
          (map, profile) => {
            map[profile.id] = profile
            return map
          },
          {}
        )
      }


      // =================================================
      // FORMAT ORDERS
      // =================================================
      const formattedOrders = data.map((order) => ({
        ...order,
        customer: profilesMap[order.customer_id] || null,
      }))

      setOrders(formattedOrders)
    }

    catch (error) {
      console.error('Failed to load billing orders:', error)
      toast.error(error.message || 'Failed to load billing orders.')
    }

    finally {
      setLoading(false)
    }
  }


  // =====================================================
  // GET PAYMENT STATUS
  // =====================================================
  function getPaymentStatus(order) {

    const total = Number(order.total_amount || 0)
    const downPayment = Number(order.down_payment_amount || 0)
    const settled = Number(order.settled_amount || 0)

    if (total > 0 && settled >= total) {
      return 'fully paid'
    }

    if (downPayment > 0 || settled > 0) {
      return 'down payment received'
    }

    return 'unpaid'
  }


  // =====================================================
  // VIEW PAYMENT
  // =====================================================
  async function viewPayment(filePath, title) {
    if (!filePath) return

    const { data, error } = await supabase
      .storage
      .from('payment-proofs')
      .createSignedUrl(filePath, 60 * 5)

    if (error) {
      console.error(error)
      toast.error(`Failed to load ${title}.`)
      return
    }

    window.open(data.signedUrl, '_blank')
  }


  // =====================================================
  // CALCULATE REMAINING BALANCE
  // =====================================================
  function getRemainingBalance(order) {
    const total = Number(order.total_amount || 0)
    const settled = Number(order.settled_amount || 0)

    return Math.max(total - settled, 0)
  }


  // =====================================================
  // FORMAT CURRENCY
  // =====================================================
  function formatCurrency(amount) {
    return `₱ ${Number(amount || 0).toLocaleString( undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2})}`
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    loadCustomerOrders()
  }, [])



  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (
    <div>

      {/* =================================================
          HEADER
      ================================================= */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Billings
        </h1>

        <p className="mt-1 text-gray-500">
          View and track customer order billing and payment information.
        </p>
      </div>


      {/* =================================================
          TABLE
      ================================================= */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full">

            <thead className="bg-[#F4F8F5]">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Order
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Customer
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Total Amount
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Down Payment
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Settled Payment
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Balance
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Status
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (

                <tr>
                  <td colSpan="8" className="py-10 text-center text-sm text-gray-500">
                    Loading billing records...
                  </td>
                </tr>

              ) : orders.length > 0 ? (

                orders.map((order) => {

                  const balance =  getRemainingBalance(order)

                  return (
                    <tr key={order.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

                      {/* ORDER */}
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-800">
                          {order.order_number || '-'}
                        </p>

                        {order.quotation_number && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            Quotation: {order.quotation_number}
                          </p>
                        )}
                      </td>

                      {/* CUSTOMER */}
                      <td className="px-5 py-4">
                        <p className="font-medium text-gray-800">
                          {order.customer?.name || '-'}
                        </p>

                        {order.customer?.company && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            {order.customer.company}
                          </p>
                        )}
                      </td>

                      {/* TOTAL */}
                      <td className="px-5 py-4 font-semibold text-gray-800">
                        {formatCurrency(order.total_amount)}
                      </td>

                      {/* DOWN PAYMENT */}
                      <td className="px-5 py-4 text-gray-700">
                        {formatCurrency(order.down_payment_amount)}
                      </td>

                      {/* SETTLED PAYMENT */}
                      <td className="px-5 py-4 text-gray-700">
                        {formatCurrency(order.settled_amount)}
                      </td>

                      {/* BALANCE */}
                      <td className="px-5 py-4">
                        <span className={balance > 0 ? 'font-semibold text-amber-600' : 'font-semibold text-green-600'}>
                          {formatCurrency(balance)}
                        </span>
                      </td>

                      {/* PAYMENT STATUS */}
                      <td className="px-5 py-4">
                        <StatusBadge status={getPaymentStatus(order)} />
                      </td>

                      {/* ACTION */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">

                          {/* DOWN PAYMENT PROOF */}
                          {order.payment_proof_dp && (
                            <IconButton
                              icon={faFileInvoice}
                              title="View Down Payment Proof"
                              color="blue"
                              disabled={false}
                              onClick={() => viewPayment(order.payment_proof_dp, 'Down Payment Proof')}
                            />
                          )}

                          {/* COMPLETE PAYMENT PROOF */}
                          {order.payment_proof_complete && (
                            <IconButton
                              icon={faFileInvoice}
                              title="View Complete Payment Proof"
                              color="green"
                              disabled={false}
                              onClick={() => viewPayment(order.payment_proof_complete, 'Complete Payment Proof')}
                            />
                          )}

                        </div>
                      </td>
                    </tr>
                  )
                })
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
      </div>
    </div>
  )
}