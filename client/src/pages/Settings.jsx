'use client'

import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'


export default function SettingsPage() {

  const { toast } = useToast()

  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [deleting, setDeleting] = useState(false)


  // =====================================================
  // DELETE ALL ORDER / QUOTATION DATA
  // =====================================================
  async function deleteAllData() {
    setDeleting(true)

    try {
      const tables = [
        'compliance_label_exchanges',
        'customer_order_items',
        'customer_order_status_history',
        'quotation_items',
        'quotation_request_items',
        'quotations',
        'quotation_requests',
        'purchase_order_items',
        'purchase_orders',
        'customer_orders',
        'notifications',
      ]
      
      for (const table of tables) {
        const { error } = await supabase
          .from(table)
          .delete()
          .not('id', 'is', null)

        if (error) {
          throw error
        }
      }

      // =================================================
      // RESET WAREHOUSE RACKS
      // =================================================
      const { error: rackError } = await supabase
        .from('warehouse_racks')
        .update({
          is_occupied: false,
          updated_at: new Date().toISOString(),
        })
        .not('id', 'is', null)

      if (rackError) {
        throw rackError
      }

      toast.success('All order data deleted and warehouse racks reset.')
      setShowDeleteConfirmation(false)
    }
    
    catch (error) {
      console.error('Failed to delete all data:', error)
      toast.error(error.message || 'Failed to delete all data.')
    }
    
    finally {
      setDeleting(false)
    }
  }


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
          Settings
        </h1>

        <p className="mt-1 text-gray-500">
          Manage system settings and administrative actions.
        </p>
      </div>


      {/* =================================================
          SETTINGS
      ================================================= */}
      <div className="space-y-6">


        {/* =================================================
            DANGER ZONE
        ================================================= */}
        <div className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">

          <div className="border-b border-red-100 bg-red-50 px-6 py-4">
            <h2 className="text-base font-semibold text-red-700">
              Danger Zone
            </h2>

            <p className="mt-1 text-sm text-red-600">
              Actions in this section can permanently affect
              system data.
            </p>
          </div>


          {/* ---------------------------------------------
              DELETE ACTION
          --------------------------------------------- */}
          <div className="flex items-center justify-between gap-6 px-6 py-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Delete
              </h3>

              <p className="mt-1 text-sm text-gray-500">
                Permanently delete the selected data.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowDeleteConfirmation(true)}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-700"
            >
              Delete All Data
            </button>
          </div>
        </div>
      </div>


      {/* =====================================================
          DELETE CONFIRMATION MODAL
      ===================================================== */}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">

            {/* HEADER */}
            <div className="border-b border-gray-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-red-600">
                Delete All Data?
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                This action will permanently delete all quotation,
                purchase order, customer order, and compliance label data.
              </p>
            </div>


            {/* CONTENT */}
            <div className="px-6 py-5">

              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-700">
                  Warning: This action cannot be undone.
                </p>

                <p className="mt-2 text-sm text-red-600">
                  The following data will be deleted:
                </p>

                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-600">
                  <li>Compliance label exchanges</li>
                  <li>Customer order status history</li>
                  <li>Customer order items</li>
                  <li>Customer orders</li>
                  <li>Notifications</li>
                  <li>Purchase order items</li>
                  <li>Purchase orders</li>
                  <li>Quotation items</li>
                  <li>Quotation request items</li>
                  <li>Quotation requests</li>
                  <li>Quotations</li>
                </ul>

                <p className="mt-3 text-sm font-medium text-red-700">
                  All warehouse racks will also be marked as unoccupied.
                </p>
              </div>

            </div>


            {/* FOOTER */}
            <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">

              <button
                type="button"
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={deleteAllData}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Yes, Delete Everything'}
              </button>

            </div>

          </div>
        </div>
      )}

    </div>
  )
}