// =============================================================================
// Warehouse space: floors and pallet slots (db/migrations/043)
//
// A slot is one pallet spot: 1.2 m x 1.0 m on a 2 m shelf, so up to 2.4 m³ of
// cases. A slot holds goods of ONE customer order, but several products of that
// order may share it. What a slot holds is counted from the cases: cases x each
// product's volume per case. The database checks the same limits when a
// delivery is recorded; this is what the screens show and suggest.
// =============================================================================

export const SLOT_CBM = 2.4                 // 1.2 m x 1.0 m pallet, 2 m shelf
export const HIGH_CUBE_CBM = 76.3           // inside a 40-ft high cube
// DMC's rule: "about to be full" when 2 high cubes' worth of space is left.
export const NEARLY_FULL_FREE_CBM = 2 * HIGH_CUBE_CBM

const sum = (values) => values.reduce((total, value) => total + value, 0)
const EPSILON = 1e-9


// How much space is free. A slot with goods in it counts as used in full: only
// the same order's goods could still go in it. Inactive slots don't count.
export function summarizeCapacity(racks) {
  const active = (racks || []).filter((rack) => rack.is_active)
  const free = active.filter((rack) => !rack.is_occupied)

  const totalCbm = sum(active.map((rack) => Number(rack.capacity_cbm || 0)))
  const freeCbm = sum(free.map((rack) => Number(rack.capacity_cbm || 0)))
  const usedPercent = totalCbm > 0 ? Math.round(((totalCbm - freeCbm) / totalCbm) * 100) : 100

  return {
    totalRacks: active.length,
    freeRacks: free.length,
    totalCbm,
    freeCbm,
    freeHighCubes: freeCbm / HIGH_CUBE_CBM,
    usedPercent,
    isFull: free.length === 0,
    isNearlyFull: free.length > 0 && freeCbm <= NEARLY_FULL_FREE_CBM + EPSILON,
  }
}


// How many cases of a product fit in a space. A product with no volume on
// record (old test data) can't be measured, so it isn't limited.
export function casesThatFit(capacityCbm, caseVolume) {
  const volume = Number(caseVolume)
  if (!(volume > 0)) return Infinity

  // The small nudge stops floating-point maths losing a case, e.g. 0.3 / 0.1.
  return Math.max(Math.floor(Number(capacityCbm || 0) / volume + 1e-9), 0)
}


// A slot's goods other than this delivery line's own.
const othersIn = (slot, lineId) => (slot?.contents || []).filter((entry) => entry.lineId !== lineId)

// m³ still free in a slot for this line: its capacity less everything else in it.
export function slotRoom(slot, lineId = null) {
  const used = sum(othersIn(slot, lineId).map((entry) => Number(entry.quantity || 0) * Number(entry.cbm || 0)))
  return Math.max(Number(slot?.capacity_cbm || 0) - used, 0)
}

// The other order whose goods are in a slot (its number), or null.
export function slotOtherOrder(slot, lineId, orderId) {
  const other = othersIn(slot, lineId).find((entry) => entry.orderId && entry.orderId !== orderId)
  return other ? other.orderNumber || 'another order' : null
}

// m³ of goods in a slot, all of them.
export const slotUsed = (slot) => sum((slot?.contents || []).map((entry) => Number(entry.quantity || 0) * Number(entry.cbm || 0)))


// Where a delivery line's cases should go (DMC's rule, 2026-11-22):
//   1. slots this line already sits in, up to what fits;
//   2. whole pallets of this product, each in an empty slot;
//   3. what's left, into a slot that already holds this order's goods and has
//      room for all of it (the tightest fit), else another empty slot.
// Empty slots come from the floor this order already uses, then floor by floor.
// slots: warehouse_racks rows with contents (services/warehouseSlots.js).
// `unplaced` is how many cases have nowhere to go.
export function suggestSlots({ quantity, caseVolume, slots, lineId = null, orderId = null }) {
  const volume = Number(caseVolume)
  let remaining = Number(quantity) || 0
  const allocations = []
  if (remaining <= 0) return { allocations, unplaced: 0 }

  const list = slots || []
  const holdsLine = (slot) => (slot.contents || []).some((entry) => entry.lineId === lineId)
  const held = list.filter(holdsLine)
  const usable = list.filter((slot) => !holdsLine(slot) && slot.is_active && !slotOtherOrder(slot, lineId, orderId))
  const sameOrder = usable.filter((slot) => (slot.contents || []).length > 0)
  const empty = usable.filter((slot) => (slot.contents || []).length === 0 && !slot.is_occupied)

  const orderFloors = new Set([...held, ...sameOrder].map((slot) => slot.floor))
  const byPlace = (a, b) => Number(orderFloors.has(b.floor)) - Number(orderFloors.has(a.floor))
    || Number(a.floor || 0) - Number(b.floor || 0)
    || String(a.rack_id).localeCompare(String(b.rack_id))
  empty.sort(byPlace)

  const place = (slot, cases) => {
    if (cases <= 0) return
    allocations.push({ rackId: slot.id, quantity: cases })
    remaining -= cases
  }

  // 1. Where it already is.
  for (const slot of held) {
    if (remaining <= 0) break
    place(slot, Math.min(remaining, casesThatFit(slotRoom(slot, lineId), volume)))
  }

  // No volume on record: one slot takes it all (receiving asks for the volume first).
  if (!(volume > 0)) {
    if (remaining > 0 && empty.length) place(empty.shift(), remaining)
    return { allocations, unplaced: remaining }
  }

  // 2. Whole pallets of this product.
  while (remaining > 0 && empty.length) {
    const perPallet = casesThatFit(empty[0].capacity_cbm, volume)
    if (perPallet <= 0 || remaining < perPallet) break
    place(empty.shift(), perPallet)
  }

  // 3. What's left: with this order's other goods if it all fits, else a new slot.
  if (remaining > 0) {
    const fits = sameOrder
      .filter((slot) => casesThatFit(slotRoom(slot, lineId), volume) >= remaining)
      .sort((a, b) => slotRoom(a, lineId) - slotRoom(b, lineId))
    if (fits.length) {
      place(fits[0], remaining)
    } else if (empty.length) {
      const slot = empty.shift()
      place(slot, Math.min(remaining, casesThatFit(slot.capacity_cbm ?? SLOT_CBM, volume)))
    }
  }

  // Still more (no empty slots left): any room in this order's slots.
  for (const slot of sameOrder.sort((a, b) => slotRoom(b, lineId) - slotRoom(a, lineId))) {
    if (remaining <= 0) break
    if (allocations.some((entry) => entry.rackId === slot.id)) continue
    place(slot, Math.min(remaining, casesThatFit(slotRoom(slot, lineId), volume)))
  }

  return { allocations, unplaced: remaining }
}


export const formatCbm = (value) =>
  `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`
