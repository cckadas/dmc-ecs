// =============================================================================
// Containers
//
// DMC ships each order in one container: a 20-ft, a 40-ft or a 40-ft high cube.
// An order needs the smallest one that holds the total volume and weight of its
// cases (each product's volume and gross weight per case x the cases ordered).
// The customer may choose a bigger one. Volume is only filled up to DMC's fill
// percent, since cases rarely fill every corner; weight limits are hard limits.
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
//   smallest,  the smallest size that fits, or null
//   tooBig,    true when even the largest size can't hold it
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

  return {
    load,
    options,
    smallest,
    tooBig: load.unmeasured.length === 0 && options.length > 0 && !smallest,
  }
}


export function formatVolume(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`
}


export function formatWeight(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`
}
