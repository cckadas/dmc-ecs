'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'


export default function SupplierPerformancePage() {

  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)


  // =============================================
  // LOAD SUPPLIERS
  // =============================================
  async function loadSuppliers() {

    setLoadingSuppliers(true)

    const { data, error } = await supabase
      .from('suppliers')
      .select(`
        id,
        supplier_name,
        supplier_type
      `)
      .order('supplier_name', { ascending: true })

    if (error) {
      toast.error(error.message)
      setLoadingSuppliers(false)
      return
    }

    setSuppliers(data || [])
    setLoadingSuppliers(false)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadSuppliers()
  }, [])


  // =============================================
  // SELECTED SUPPLIER
  // =============================================
  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === selectedSupplierId
  )


  return (
    <div>

      {/* =============================================
          HEADER
      ============================================= */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Supplier Performance
          </h1>

          <p className="text-gray-500">
            Monitor and evaluate supplier performance.
          </p>
        </div>


        {/* Supplier Dropdown */}
        <div className="w-64">
          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            disabled={loadingSuppliers}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 outline-none transition focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20 disabled:cursor-not-allowed disabled:bg-gray-100"
          >

            <option value="">
              {loadingSuppliers ? 'Loading suppliers...' : 'Select supplier'}
            </option>

            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.supplier_name}
              </option>
            ))}
          </select>
        </div>
      </div>


      {/* =============================================
          PERFORMANCE CARD
      ============================================= */}
      {selectedSupplier ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

          {/* Card Header */}
          <div className="border-b bg-[#F4F8F5] px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#1F3A2C]">
                  {selectedSupplier.supplier_name}
                </h2>

                <p className="mt-0 text-sm text-gray-500">
                  {selectedSupplier.supplier_type}
                </p>
              </div>

              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                No performance data
              </span>
            </div>
          </div>


          {/* Performance Content */}
          <div className="p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">

              {/* On-Time Delivery */}
              <div className="rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-500">
                  On-Time Delivery
                </p>

                <p className="mt-2 text-2xl font-bold text-gray-300">
                  —
                </p>
              </div>


              {/* Order Accuracy */}
              <div className="rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-500">
                  Order Accuracy
                </p>

                <p className="mt-2 text-2xl font-bold text-gray-300">
                  —
                </p>
              </div>


              {/* Quality */}
              <div className="rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-500">
                  Quality
                </p>

                <p className="mt-2 text-2xl font-bold text-gray-300">
                  —
                </p>
              </div>


              {/* Overall Rating */}
              <div className="rounded-lg border border-gray-200 p-5">
                <p className="text-sm text-gray-500">
                  Overall Rating
                </p>

                <p className="mt-2 text-2xl font-bold text-gray-300">
                  —
                </p>
              </div>
            </div>


            {/* Empty State */}
            <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
              <p className="font-medium text-gray-600">
                No performance data available
              </p>

              <p className="mt-1 text-sm text-gray-400">
                Supplier performance metrics will appear here once performance data is available.
              </p>
            </div>

          </div>
        </div>
      ) : (

        /* =============================================
           NO SUPPLIER SELECTED
        ============================================= */
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center">
          <p className="font-medium text-gray-600">
            Select a supplier
          </p>

          <p className="mt-1 text-sm text-gray-400">
            Choose a supplier above to view their performance.
          </p>
        </div>
      )}
    </div>
  )
}