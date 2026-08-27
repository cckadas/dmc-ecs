'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { 
  faFileInvoice,
  faBoxOpen,
  faCertificate, } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"
import StatusBadge from '../components/StatusBadge'

import IconButton from '../components/IconButton'


export default function DocumentsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)


  // =============================================
  // LOAD MY ORDERS
  // =============================================
  async function loadOrders() {
    if (!profile?.id) {
      return
    }

    setLoading(true)

    const { data, error } = await supabase
      .from('customer_orders')
      .select(`
        id,
        order_number,
        quotation_number,
        total_amount,
        status,
        settled_amount,
        payment_proof_dp,
        payment_proof_complete,
        pfi_file_path,
        created_at,

        customer_order_items (
          id
        )
      `)
      .eq('customer_id', profile.id)
      .order('created_at', {
        ascending: false,
      })

    if (error) {
      toast.error('Failed to load your orders.')
      setLoading(false)
      return
    }

    setOrders(data || [])
    setLoading(false)
  }


  // =============================================
  // VIEW DOCUMENT
  // =============================================
  async function viewDocument(path, documentName) {
    if (!path) {
      toast.error(`${documentName} is not available.`)
      return
    }

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 60)

    if (error) {
      toast.error(`Failed to open ${documentName}.`)
      return
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadOrders()
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
          Order Documents
        </h1>

        <p className="mt-1 text-gray-500">
          View attached documents for your orders.
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
                Quotation
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Items
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
                Documents
              </th>
            </tr>
          </thead>


          {/* TABLE BODY */}
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan="6"
                  className="py-10 text-center text-sm text-gray-500"
                >
                  Loading your orders...
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


                  {/* QUOTATION */}
                  <td className="px-5 py-3">
                    {order.quotation_number || '-'}
                  </td>


                  {/* ITEMS */}
                  <td className="px-5 py-3">
                    {order.customer_order_items.length || '-'}
                  </td>


                  {/* TOTAL */}
                  <td className="px-5 py-3 font-medium">
                    ₱ {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>


                  {/* STATUS */}
                  <td className="px-5 py-3">
                    <StatusBadge status={order.status}/>
                  </td>


                  {/* DATE */}
                  <td className="px-5 py-3">
                    {new Date(order.created_at).toLocaleDateString()}
                  </td>


                  {/* DOCUMENTS */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">

                      {/* PFI */}
                      <IconButton
                        icon={faFileInvoice}
                        title="View Pro Forma Invoice"
                        color="blue"
                        disabled={!order.pfi_file_path}
                        onClick={() =>
                          viewDocument(
                            order.pfi_file_path,
                            'Pro Forma Invoice'
                          )
                        }
                      />

                      {/* PACKING LIST */}
                      <IconButton
                        icon={faBoxOpen}
                        title="Packing List — Coming Soon"
                        color="blue"
                        disabled={true}
                        onClick={() => {}}
                      />

                      {/* CERTIFICATES */}
                      <IconButton
                        icon={faCertificate}
                        title="Certificates — Coming Soon"
                        color="blue"
                        disabled={true}
                        onClick={() => {}}
                      />

                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="py-10 text-center text-sm text-gray-500">
                  You have no customer orders.
                </td>
              </tr>

            )}
          </tbody>
        </table>
      </div>


    </div>
  )
}