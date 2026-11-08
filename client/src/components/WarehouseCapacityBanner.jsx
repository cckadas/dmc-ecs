import { summarizeCapacity, formatCbm } from '../utils/warehouseCapacity'


// How much warehouse space is free, with a warning when it's nearly full or full.
export default function WarehouseCapacityBanner({ racks, className = '' }) {
  if (!racks?.length) return null

  const capacity = summarizeCapacity(racks)

  const tone = capacity.isFull
    ? 'border-red-200 bg-red-50 text-red-800'
    : capacity.isNearlyFull
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-gray-200 bg-white text-gray-700'

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone} ${className}`}>
      <p className="font-medium">
        Warehouse space: {capacity.freeRacks} of {capacity.totalRacks} racks free · {formatCbm(capacity.freeCbm)} of {formatCbm(capacity.totalCbm)} free
      </p>

      {capacity.isFull && (
        <p className="mt-1">
          The warehouse is full. New deliveries can't be recorded until a rack is freed by shipping an order, or an admin adds a rack in Warehouse Locations.
        </p>
      )}

      {capacity.isNearlyFull && (
        <p className="mt-1">
          The warehouse is nearly full ({capacity.usedPercent}% in use).
        </p>
      )}
    </div>
  )
}
