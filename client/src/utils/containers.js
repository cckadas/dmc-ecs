// =============================================================================
// Containers
//
// An order needs the smallest container that holds the total volume and weight
// of its cases (each product's volume and gross weight per case x the cases
// ordered): a 20-ft, a 40-ft or a 40-ft high cube. An order too big for one
// 40-ft high cube (DMC, 2026-11-22) fills as many of them as it needs, then
// what's left goes in the smallest size that holds it; every container pays its
// own cost and the destination's shipping (db/migrations/044). Volume is only
// filled up to DMC's fill percent, since cases rarely fill every corner; weight
// limits are hard limits.
// =============================================================================

// Volumes have up to 4 decimals and weights 2, so rounding the sums keeps a load
// of exactly 33.2 m³ from coming out as 33.200000001 and needing a bigger container.
const roundVolume = (value) => Math.round(value * 10000) / 10000
const roundWeight = (value) => Math.round(value * 100) / 100


// lines: [{ name, quantity, cbm, grossWeightKg }]
// Returns { volume, weight, unmeasured: [names of products missing either] }.
export function measureLoad(lines) {
  let volume = 0
  let weight = 0
  const unmeasured = []

  for (const line of lines) {
    const cbm = Number(line.cbm)
    const kg = Number(line.grossWeightKg)

    if (!(cbm > 0) || !(kg > 0)) {
      unmeasured.push(line.name)
      continue
    }

    volume += cbm * Number(line.quantity || 0)
    weight += kg * Number(line.quantity || 0)
  }

  return { volume: roundVolume(volume), weight: roundWeight(weight), unmeasured }
}


// sizes: rows of container_sizes. fillPercent: how full the volume may be packed.
// Returns {
//   load,      what the order adds up to (see measureLoad)
//   options,   every size, smallest first, each with usableVolume, fits,
//              volumePercent and weightPercent (how full this order makes it)
//   smallest,  the smallest size that holds it all, or null
//   plan,      the containers it goes in, biggest first: [{ ...size, count }]
//              (one container when it fits in one), or null
//   count,     how many containers that is
//   multiple,  true when it needs more than one container
//   tooBig,    true when it can't be planned at all (no sizes to fill)
// }
export function planContainer({ lines, sizes, fillPercent = 100 }) {
  const load = measureLoad(lines)
  const fill = Number(fillPercent) > 0 ? Number(fillPercent) : 100

  const options = [...sizes]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((size) => {
      const usableVolume = roundVolume((Number(size.inside_cbm) * fill) / 100)
      const maxWeight = Number(size.max_weight_kg)

      return {
        ...size,
        usableVolume,
        maxWeight,
        fits: load.volume <= usableVolume && load.weight <= maxWeight,
        volumePercent: usableVolume > 0 ? (load.volume / usableVolume) * 100 : 0,
        weightPercent: maxWeight > 0 ? (load.weight / maxWeight) * 100 : 0,
      }
    })

  const smallest = load.unmeasured.length > 0 ? null : options.find((option) => option.fits) || null

  // Too big for one: as many of the largest size as it needs, then the
  // smallest size that holds what's left.
  let plan = null
  const largest = options.at(-1)
  if (smallest) {
    plan = [{ ...smallest, count: 1 }]
  } else if (load.unmeasured.length === 0 && largest && largest.usableVolume > 0 && largest.maxWeight > 0) {
    const needed = Math.max(Math.ceil(load.volume / largest.usableVolume - 1e-9), Math.ceil(load.weight / largest.maxWeight - 1e-9), 1)
    const full = needed - 1
    const rest = {
      volume: Math.max(roundVolume(load.volume - full * largest.usableVolume), 0),
      weight: Math.max(roundWeight(load.weight - full * largest.maxWeight), 0),
    }
    const last = options.find((option) => rest.volume <= option.usableVolume && rest.weight <= option.maxWeight) || largest
    plan = last.code === largest.code
      ? [{ ...largest, count: full + 1 }]
      : [{ ...largest, count: full }, { ...last, count: 1 }]
  }

  const count = plan ? plan.reduce((total, entry) => total + entry.count, 0) : 0

  return {
    load,
    options,
    smallest,
    plan,
    count,
    multiple: count > 1,
    tooBig: load.unmeasured.length === 0 && options.length > 0 && !plan,
  }
}


// How a quotation's or order's containers read: "2 × 40-ft high cube + 1 ×
// 20-ft standard" from its list (044), or its one container size before that.
// short: the sizes' codes instead of their names.
export function containerText(row, { short = false } = {}) {
  const plan = Array.isArray(row?.container_plan) ? row.container_plan : null
  if (!plan?.length) return row?.container_size || '-'
  if (plan.length === 1 && Number(plan[0].count) === 1) return (short ? plan[0].code : plan[0].name) || row.container_size || '-'
  return plan.map((entry) => `${entry.count} × ${(short ? entry.code : entry.name) || entry.code}`).join(' + ')
}

// How many containers a quotation or order uses.
export const containerCount = (row) => (Array.isArray(row?.container_plan) && row.container_plan.length
  ? row.container_plan.reduce((total, entry) => total + Number(entry.count || 0), 0)
  : row?.container_size ? 1 : 0)


export function formatVolume(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`
}


export function formatWeight(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`
}
