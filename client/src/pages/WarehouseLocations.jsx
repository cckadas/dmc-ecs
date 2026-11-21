'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import ExportButton from '../components/ExportButton'
import { exportList, number } from '../utils/csvExport'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faPlus, faWarehouse } from '@fortawesome/free-solid-svg-icons'
import { useToast } from '../context/ToastContext'

import WarehouseCapacityBanner from '../components/WarehouseCapacityBanner'
import { formatCbm, HIGH_CUBE_CBM, SLOT_CBM, slotUsed } from '../utils/warehouseCapacity'
import { loadSlots } from '../services/warehouseSlots'


// =============================================================================
// Warehouse Locations: floors and pallet slots (db/migrations/043)
//
// Each slot is one pallet spot (1.2 m x 1.0 m on a 2 m shelf, up to 2.4 m³).
// A slot holds one order's goods; that order's products may share it. Goods
// are put in slots at Receiving and leave at Staging; admin adds slots and
// floors, and can stop a slot being used.
// =============================================================================

const plural = (count, word) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`
const slotNumber = (slot) => String(slot.rack_id || '').replace(/^F\d+-/, '')

// free, part of a pallet used, full, or not in use
function slotState(slot) {
  if (!slot.is_active) return 'off'
  if (!slot.is_occupied && !slot.contents.length) return 'free'
  const used = slotUsed(slot)
  return used >= Number(slot.capacity_cbm || SLOT_CBM) - 0.05 ? 'full' : 'part'
}

const TILE = {
  free: 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50',
  part: 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200',
  full: 'border-[#2D5A42] bg-[#2D5A42] text-white hover:bg-[#244a36]',
  off: 'border-dashed border-gray-300 bg-gray-100 text-gray-400 hover:bg-gray-200',
}
const STATE_TEXT = { free: 'Free', part: 'Partly used', full: 'Full', off: 'Not in use' }


export default function WarehouseLocationsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const isAdmin = profile?.role === 'admin'

  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [floorShown, setFloorShown] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding] = useState(null)
  const [saving, setSaving] = useState(false)


  async function load() {
    setLoading(true)
    try {
      setSlots(await loadSlots())
    } catch (error) {
      console.error('Failed to load warehouse slots:', error)
      toast.error(error.message || 'Failed to load warehouse locations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])


  // Floors, each with its slots and how much space is left.
  const floors = useMemo(() => {
    const byFloor = {}
    for (const slot of slots) (byFloor[slot.floor ?? 0] ||= []).push(slot)
    return Object.entries(byFloor)
      .map(([floor, list]) => {
        const active = list.filter((slot) => slot.is_active)
        const free = active.filter((slot) => slotState(slot) === 'free')
        const freeCbm = free.reduce((total, slot) => total + Number(slot.capacity_cbm || 0), 0)
        return { floor: Number(floor), slots: list, active: active.length, free: free.length, freeCbm }
      })
      .sort((a, b) => a.floor - b.floor)
  }, [slots])

  const shownFloors = floorShown === 'all' ? floors : floors.filter((entry) => String(entry.floor) === floorShown)
  const selected = slots.find((slot) => slot.id === selectedId) || null
  const simulated = slots.some((slot) => slot.is_simulated)


  // Admin: stop a slot being used for new goods, or use it again.
  async function setActive(slot, active) {
    setSaving(true)
    try {
      const { error } = await supabase.from('warehouse_racks').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', slot.id)
      if (error) throw error
      toast.success(active ? `${slot.rack_id} is in use again.` : `${slot.rack_id} won't be used for new goods.`)
      await load()
    } catch (error) {
      toast.error(error.message || 'The slot could not be changed.')
    } finally {
      setSaving(false)
    }
  }

  // Admin: more slots on a floor (a new floor number adds a floor).
  async function addSlots() {
    const floor = Number(adding?.floor)
    const count = Number(adding?.count)
    if (!(Number.isInteger(floor) && floor > 0)) return toast.error('Enter the floor number (1 or more).')
    if (!(Number.isInteger(count) && count > 0 && count <= 500)) return toast.error('Enter how many slots to add (1 to 500).')

    const taken = slots
      .filter((slot) => slot.floor === floor)
      .map((slot) => Number(slotNumber(slot)) || 0)
    const start = (taken.length ? Math.max(...taken) : 0) + 1
    const rows = Array.from({ length: count }, (_, i) => {
      const code = `F${floor}-${String(start + i).padStart(3, '0')}`
      return { rack_id: code, name: code, location: `Floor ${floor}`, floor, capacity_cbm: SLOT_CBM, is_active: true, is_occupied: false }
    })

    setSaving(true)
    try {
      const { error } = await supabase.from('warehouse_racks').insert(rows)
      if (error) throw error
      toast.success(`${plural(count, 'slot')} added on floor ${floor}: ${rows[0].rack_id}${count > 1 ? ` to ${rows.at(-1).rack_id}` : ''}.`)
      setAdding(null)
      await load()
    } catch (error) {
      toast.error(error.message || 'The slots could not be added.')
    } finally {
      setSaving(false)
    }
  }


  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">Warehouse Locations</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Floors and pallet slots. A slot is one 1.2 m × 1.0 m pallet on a 2 m shelf, up to {formatCbm(SLOT_CBM)} of cases.
            A slot holds one order's goods; that order's products may share it. Goods go into slots at Receiving and leave at Staging.
          </p>
          {simulated && (
            <p className="mt-1 text-xs text-gray-500">
              Simulated from DMC's floor sizes (40-ft high cubes' worth per floor: {formatCbm(HIGH_CUBE_CBM)} each), until DMC counts its real slots.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={floorShown}
            onChange={(e) => setFloorShown(e.target.value)}
            aria-label="Floor shown"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42]"
          >
            <option value="all">All floors</option>
            {floors.map((entry) => (
              <option key={entry.floor} value={String(entry.floor)}>{entry.floor ? `Floor ${entry.floor}` : 'Racks'}</option>
            ))}
          </select>
          <ExportButton count={slots.length} onExport={(how) => exportList(how, 'warehouse-slots', SLOT_COLUMNS, shownFloors.flatMap((entry) => entry.slots))} />
          {isAdmin && (
            <button
              type="button"
              onClick={() => setAdding({ floor: floors.at(-1)?.floor || 1, count: 10 })}
              className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#244a36]"
            >
              <FontAwesomeIcon icon={faPlus} className="mr-2" />
              Add Slots
            </button>
          )}
        </div>
      </div>

      <WarehouseCapacityBanner racks={slots} className="mb-6" />

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading...</p>
      ) : !slots.length ? (
        <p className="py-10 text-center text-sm text-gray-500">No slots yet.</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {shownFloors.map((entry) => (
              <section key={entry.floor} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-[#1F3A2C]">
                    <FontAwesomeIcon icon={faWarehouse} className="mr-2 text-[#2D5A42]" />
                    {entry.floor ? `Floor ${entry.floor}` : 'Racks'}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {plural(entry.free, 'slot')} free of {entry.active} · {formatCbm(entry.freeCbm)} free
                    {' '}(about {(entry.freeCbm / HIGH_CUBE_CBM).toLocaleString(undefined, { maximumFractionDigits: 1 })} high cubes' worth)
                  </p>
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(2.6rem,1fr))] gap-1">
                  {entry.slots.map((slot) => {
                    const state = slotState(slot)
                    const order = [...new Set(slot.contents.map((item) => item.orderNumber).filter(Boolean))].join(', ')
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => setSelectedId(slot.id)}
                        title={`${slot.rack_id} · ${STATE_TEXT[state]}${order ? ` · ${order}` : ''}${slot.contents.length ? ` · ${formatCbm(slotUsed(slot))} of ${formatCbm(slot.capacity_cbm)}` : ''}`}
                        className={`h-9 rounded border text-[11px] font-medium ${TILE[state]} ${selectedId === slot.id ? 'ring-2 ring-[#1F3A2C] ring-offset-1' : ''}`}
                      >
                        {slotNumber(slot)}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}

            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              {Object.entries(STATE_TEXT).map(([state, text]) => (
                <span key={state} className="flex items-center gap-1.5">
                  <span className={`inline-block h-3.5 w-3.5 rounded border ${TILE[state]}`} />
                  {text}
                </span>
              ))}
            </div>
          </div>

          <aside className="h-fit rounded-xl border border-gray-200 bg-white p-4 xl:sticky xl:top-4">
            {!selected ? (
              <p className="text-sm text-gray-500">Choose a slot to see what's in it.</p>
            ) : (
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-[#1F3A2C]">{selected.rack_id}</h3>
                    <p className="text-sm text-gray-500">{selected.floor ? `Floor ${selected.floor}` : selected.location || 'No floor'} · {STATE_TEXT[slotState(selected)]}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedId(null)} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100">
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>

                <p className="mt-3 text-sm text-gray-700">
                  {formatCbm(slotUsed(selected))} of {formatCbm(selected.capacity_cbm)} used
                </p>

                {selected.contents.length ? (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {[...new Set(selected.contents.map((item) => item.orderNumber).filter(Boolean))].join(', ') || 'Goods'}
                    </p>
                    <ul className="mt-1 space-y-1 text-sm text-gray-700">
                      {selected.contents.map((item) => (
                        <li key={item.lineId} className="flex justify-between gap-2">
                          <span>{item.product}</span>
                          <span className="shrink-0">{item.quantity.toLocaleString()} {item.unit}{item.cbm ? ` · ${formatCbm(item.quantity * item.cbm)}` : ' · no volume on record'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">Empty.</p>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setActive(selected, !selected.is_active)}
                    className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {selected.is_active ? 'Stop using this slot for new goods' : 'Use this slot again'}
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-gray-800">Add Slots</h2>
            <p className="mt-1 text-sm text-gray-600">Each new slot holds one pallet ({formatCbm(SLOT_CBM)}). A floor number not used yet adds a new floor.</p>

            <label className="mt-4 block text-sm font-medium text-gray-700">
              Floor
              <input type="number" min="1" value={adding.floor} onChange={(e) => setAdding((prev) => ({ ...prev, floor: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2D5A42]" />
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              How many
              <input type="number" min="1" max="500" value={adding.count} onChange={(e) => setAdding((prev) => ({ ...prev, count: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2D5A42]" />
            </label>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(null)} disabled={saving} className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
                Cancel
              </button>
              <button type="button" onClick={addSlots} disabled={saving} className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#244a36] disabled:opacity-50">
                {saving ? 'Adding...' : 'Add Slots'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js): a row per slot, for the floor shown (or all).
// =============================================
const SLOT_COLUMNS = [
  { header: 'Slot', value: (slot) => slot.rack_id },
  { header: 'Floor', value: (slot) => slot.floor ?? '' },
  { header: 'State', value: (slot) => STATE_TEXT[slotState(slot)] },
  { header: 'Order', value: (slot) => [...new Set(slot.contents.map((item) => item.orderNumber).filter(Boolean))].join(', ') },
  { header: 'Goods (m3)', value: (slot) => number(slotUsed(slot)) },
  { header: 'Capacity (m3)', value: (slot) => number(slot.capacity_cbm) },
]
