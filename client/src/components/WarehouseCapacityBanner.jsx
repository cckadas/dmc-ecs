import { summarizeCapacity, formatCbm, HIGH_CUBE_CBM } from '../utils/warehouseCapacity'


// How much warehouse space is free, with a warning when it's about to be full
// (2 high cubes' worth left, DMC's rule) or full. A slot with goods in it
// counts as used: only the same order's goods could still go in it.
export default function WarehouseCapacityBanner({ racks, className = '' }) {
  if (!racks?.length) return null

  const capacity = summarizeCapacity(racks)
  const highCubes = (capacity.freeCbm / HIGH_CUBE_CBM).toLocaleString(undefined, { maximumFractionDigits: 1 })

  const tone = capacity.isFull
    ? 'border-red-200 bg-red-50 text-red-800'
    : capacity.isNearlyFull
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-gray-200 bg-white text-gray-700'

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone} ${className}`}>
      <p className="font-medium">
        Warehouse space: {capacity.freeRacks.toLocaleString()} of {capacity.totalRacks.toLocaleString()} slots free · {formatCbm(capacity.freeCbm)} (about {highCubes} high cubes' worth)
      </p>

      {capacity.isFull && (
        <p className="mt-1">
          The warehouse is full. New deliveries can't be recorded until slots are freed by loading or shipping an order, or an admin adds slots in Warehouse Locations.
        </p>
      )}

      {capacity.isNearlyFull && (
        <p className="mt-1">
          The warehouse is about to be full: only 2 high cubes' worth of space or less is left.
        </p>
      )}
    </div>
  )
}
