import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { formatDateTime } from '../utils/dates'


// =============================================
// VOLUME PER CASE
//
// Warehouse staff (and admin) correct how much space one case of a product
// takes, in m³: the value the system plans containers with. Saved through one
// step that changes nothing else (db/migrations/033), and every change is
// recorded with who and when; the latest is shown here.
// =============================================

const formatVolume = (value) =>
  value == null || value === '' ? '-' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })} m³`

export default function CaseVolumeModal({ product, onClose, onSaved }) {
  const { toast } = useToast()
  const [value, setValue] = useState(product.cbm == null ? '' : String(product.cbm))
  const [lastChange, setLastChange] = useState(null)
  const [saving, setSaving] = useState(false)

  // The latest change, if the record exists yet (033).
  useEffect(() => {
    let active = true
    supabase
      .from('product_case_volume_history')
      .select('old_cbm, new_cbm, changed_at, changed_by_name, changed_by_role')
      .eq('product_id', product.id)
      .order('changed_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (active && !error) setLastChange(data?.[0] || null)
      })
    return () => { active = false }
  }, [product.id])

  async function save() {
    const volume = Number(value)

    if (value === '' || !(volume > 0) || volume > 2) {
      toast.error('Enter the volume of one case in m³: more than 0 and at most 2 (for example 0.0242).')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.rpc('set_case_volume', { p_product_id: product.id, p_cbm: volume })

      if (error) {
        toast.error(
          error.code === 'PGRST202' || /set_case_volume/.test(error.message || '')
            ? 'Changing the volume per case needs db/migrations/033 to be run first.'
            : error.message || 'Failed to save the volume per case.'
        )
        return
      }

      toast.success(`Volume per case of ${product.product_name} saved: ${formatVolume(volume)}.`)
      await onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Volume per case</h2>
            <p className="text-sm text-gray-500">
              {product.product_name}{product.pack_size ? ` · ${product.pack_size}` : ''}
            </p>
          </div>

          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5 text-sm">
          <p className="text-gray-600">
            Now: <span className="font-medium text-gray-800">{formatVolume(product.cbm)}</span> per case
          </p>

          {lastChange && (
            <p className="text-xs text-gray-500">
              Last changed {formatDateTime(lastChange.changed_at)}
              {lastChange.changed_by_name ? ` by ${lastChange.changed_by_name}` : ''}
              {lastChange.changed_by_role ? ` (${lastChange.changed_by_role})` : ''}, from {formatVolume(lastChange.old_cbm)}.
            </p>
          )}

          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Volume of one case (m³)</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.0001"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
            />
          </label>

          <p className="text-xs text-gray-500">
            How much space one whole case takes, in cubic metres: for example 0.0242 m³ is a case of about 29 × 29 × 29 cm.
            Only quotations made from now on plan their container with the new value.
          </p>
        </div>

        <div className="flex justify-end gap-3 bg-gray-50 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
