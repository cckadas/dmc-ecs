import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'


// =============================================================================
// Owed by suppliers (db/migrations/045)
//
// Cases a supplier didn't deliver although DMC had paid for them. They count
// toward DMC's next purchase order of that product from that supplier, or
// procurement marks them refunded when the supplier pays them back. Hidden
// while there are none, or before 045 is run.
// =============================================================================

export default function OwedBySuppliers() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [closing, setClosing] = useState(null)
  const canClose = ['admin', 'procurement'].includes(profile?.role)

  async function load() {
    const { data, error } = await supabase
      .from('supplier_owed_cases')
      .select('id, cases, used_cases, unit_price, created_at, created_by_name, refunded_at, suppliers ( supplier_name ), products ( product_name, unit ), purchase_order_items ( purchase_orders ( po_number ) ), customer_orders ( order_number )')
      .is('refunded_at', null)
      .order('created_at', { ascending: true })
    if (error) return            // 045 not run yet: nothing to show
    setRows((data || []).filter((row) => Number(row.cases) > Number(row.used_cases || 0)))
  }

  useEffect(() => {
    load()
  }, [])

  async function markRefunded(row) {
    if (!window.confirm(`Mark the ${row.cases - row.used_cases} cases of ${row.products?.product_name || 'this product'} as refunded by ${row.suppliers?.supplier_name || 'the supplier'}? They won't count toward a later purchase order.`)) return
    setClosing(row.id)
    try {
      const { error } = await supabase.rpc('mark_owed_cases_refunded', { p_owed_id: row.id })
      if (error) throw error
      toast.success('Marked as refunded by the supplier.')
      await load()
    } catch (error) {
      toast.error(error.message || 'Could not mark it refunded.')
    } finally {
      setClosing(null)
    }
  }

  if (!rows.length) return null

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-900">Owed by suppliers</h2>
      <p className="mt-0.5 text-sm text-amber-900">
        Cases a supplier didn't deliver although DMC had paid for them. They count toward DMC's next purchase order of that product from that supplier.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm text-amber-950">
          <thead className="text-xs uppercase tracking-wide text-amber-800">
            <tr>
              <th className="py-1.5 pr-4">Supplier</th>
              <th className="py-1.5 pr-4">Product</th>
              <th className="py-1.5 pr-4">Owed</th>
              <th className="py-1.5 pr-4">From</th>
              <th className="py-1.5 pr-4">Recorded</th>
              {canClose && <th className="py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-amber-200">
                <td className="py-1.5 pr-4">{row.suppliers?.supplier_name || '-'}</td>
                <td className="py-1.5 pr-4">{row.products?.product_name || '-'}</td>
                <td className="py-1.5 pr-4 font-semibold">{(row.cases - row.used_cases).toLocaleString()} {row.products?.unit || 'cases'}</td>
                <td className="py-1.5 pr-4">{[row.purchase_order_items?.purchase_orders?.po_number, row.customer_orders?.order_number].filter(Boolean).join(' · ') || '-'}</td>
                <td className="py-1.5 pr-4">{new Date(row.created_at).toLocaleDateString()}{row.created_by_name ? ` · ${row.created_by_name}` : ''}</td>
                {canClose && (
                  <td className="py-1.5 text-right">
                    <button type="button" disabled={closing === row.id} onClick={() => markRefunded(row)} className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                      Refunded by Supplier
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
