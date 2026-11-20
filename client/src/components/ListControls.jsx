// =============================================
// LIST CONTROLS
//
// Above a page's list of records: Show (one status or group, with how many
// each has), Sort by, and Search, with how many records are showing. The
// choices come from utils/listControls.js; each page keeps its own state.
// onExport (optional): an Export button that downloads what is showing as a
// CSV file (utils/csvExport.js).
// =============================================

import ExportButton from './ExportButton'

const field = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800'

export default function ListControls({
  choices,
  show,
  onShow,
  sorts,
  sortBy,
  onSort,
  search,
  onSearch,
  searchPlaceholder = 'Number',
  shown,
  total,
  noun = 'records',
  loading = false,
  onExport = null,
  className = 'mb-4',
}) {
  return (
    <div className={`flex flex-wrap items-end gap-4 ${className}`}>
      {choices && onShow && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Show
          <select value={show} onChange={(event) => onShow(event.target.value)} className={field}>
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label} ({choice.count})
              </option>
            ))}
          </select>
        </label>
      )}

      {sorts && onSort && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Sort by
          <select value={sortBy} onChange={(event) => onSort(event.target.value)} className={field}>
            {sorts.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {onSearch && (
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className={`${field} w-64`}
          />
        </label>
      )}

      {!loading && typeof total === 'number' && (
        <p className="pb-2 text-sm text-gray-500">
          Showing {shown} of {total} {noun}
        </p>
      )}

      {onExport && (
        <ExportButton onExport={onExport} count={loading ? 0 : shown} className="ml-auto" />
      )}
    </div>
  )
}
