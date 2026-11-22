import { useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'


// =============================================================================
// Goods that didn't arrive, and a refund DMC owes (db/migrations/045)
//
// What came off an order for goods the supplier never delivered, and, when the
// customer had already paid more than the new total, the refund DMC owes or
// sent. Sales and admin record a refund once it's sent.
// =============================================================================

const peso = (value) => `₱ ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

export default function MissingGoodsNote({ order }) {
  const { profile } = useAuth()
  const { toast } = useToast()
  const [recorded, setRecorded] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const missing = Number(order?.missing_goods_amount || 0)
  const refunded = Number(recorded?.amount ?? order?.refunded_amount ?? 0)
  const due = Math.max(Math.round((Number(order?.settled_amount || 0) - refunded - Number(order?.total_amount || 0)) * 100) / 100, 0)
  const canRecord = ['admin', 'sales'].includes(profile?.role)

  if (!(missing > 0) && !(refunded > 0)) return null

  async function recordRefund() {
    if (!form?.bank?.trim()) {
      toast.error('Enter the bank the refund was sent through.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('record_order_refund', {
        p_customer_order_id: order.id,
        p_amount: due,
        p_bank: form.bank.trim(),
        p_reference: form.reference?.trim() || null,
      })
      if (error) throw error
      toast.success(`Refund of ${peso(due)} recorded. The customer is told.`)
      setRecorded({ amount: refunded + due, bank: form.bank.trim(), reference: form.reference?.trim() || null })
      setForm(null)
    } catch (error) {
      toast.error(error.message || 'The refund could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {missing > 0 && (
        <div className="flex justify-between gap-3">
          <span className="font-semibold">Goods that didn't arrive (taken off)</span>
          <span className="font-bold">− {peso(missing)}</span>
        </div>
      )}

      {due > 0 && (
        <div>
          <div className="flex justify-between gap-3">
            <span className="font-semibold">DMC owes a refund</span>
            <span className="font-bold">{peso(due)}</span>
          </div>
          {canRecord && !form && (
            <button type="button" onClick={() => setForm({ bank: '', reference: '' })} className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
              Record Refund Sent
            </button>
          )}
          {canRecord && form && (
            <div className="mt-2 space-y-2">
              <input value={form.bank} onChange={(e) => setForm((prev) => ({ ...prev, bank: e.target.value }))} placeholder="Bank it was sent through"
                className="w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-500" />
              <input value={form.reference} onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))} placeholder="Transfer reference (optional)"
                className="w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-500" />
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={recordRefund} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  {saving ? 'Saving...' : `Record ${peso(due)} Sent`}
                </button>
                <button type="button" disabled={saving} onClick={() => setForm(null)} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {refunded > 0 && (
        <div className="flex justify-between gap-3">
          <span>
            Refunded{(recorded?.bank || order?.refund_bank) ? ` through ${recorded?.bank || order.refund_bank}` : ''}
            {(recorded?.reference || order?.refund_reference) ? ` (ref. ${recorded?.reference || order.refund_reference})` : ''}
          </span>
          <span className="font-semibold">{peso(refunded)}</span>
        </div>
      )}
    </div>
  )
}
