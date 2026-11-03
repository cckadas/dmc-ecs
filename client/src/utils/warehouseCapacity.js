// =============================================================================
// Warehouse space
//
// A rack holds one delivery line at a time, up to its capacity in m³. A case's
// volume comes from the product (products.cbm), so how many cases fit in a rack
// depends on the product. The database checks the same limits when a delivery is
// recorded (db/migrations/012); this is what the screens show and suggest.
// =============================================================================

// At this share of the warehouse in use, the screens warn it's nearly full.
export const NEARLY_FULL_PERCENT = 80

const sum = (values) => values.reduce((total, value) => total + value, 0)


// How much space is free. An occupied rack counts as used in full, since nothing
// else can go in it. Inactive racks don't count at all.
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
    usedPercent,
    isFull: free.length === 0,
    isNearlyFull: free.length > 0 && usedPercent >= NEARLY_FULL_PERCENT,
  }
}


// How many cases of a product fit in a rack. A product with no volume on record
// (old test data) can't be measured, so it isn't limited.
export function casesThatFit(capacityCbm, caseVolume) {
  const volume = Number(caseVolume)
  if (!(volume > 0)) return Infinity

  // The small nudge stops floating-point maths losing a case, e.g. 0.3 / 0.1.
  return Math.floor(Number(capacityCbm || 0) / volume + 1e-9)
}


// Which racks to use for a delivery: racks this line already sits in, then free
// active racks in rack order, each filled up to what fits. `unplaced` is how many
// cases have nowhere to go.
export function suggestRacks({ quantity, caseVolume, racks, heldRackIds = [] }) {
  const isHeld = (rack) => heldRackIds.includes(rack.id)

  const usable = (racks || [])
    .filter((rack) => isHeld(rack) || (rack.is_active && !rack.is_occupied))
    .sort((a, b) => Number(isHeld(b)) - Number(isHeld(a)) || String(a.rack_id).localeCompare(String(b.rack_id)))

  const allocations = []
  let remaining = Number(quantity) || 0

  for (const rack of usable) {
    if (remaining <= 0) break

    const share = Math.min(remaining, casesThatFit(rack.capacity_cbm, caseVolume))

    if (share > 0) {
      allocations.push({ rackId: rack.id, quantity: share })
      remaining -= share
    }
  }

  return { allocations, unplaced: remaining }
}


export const formatCbm = (value) =>
  `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`
