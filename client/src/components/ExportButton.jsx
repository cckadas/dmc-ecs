import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileCsv } from '@fortawesome/free-solid-svg-icons'


// =============================================
// EXPORT
//
// Downloads what the list shows as a CSV file (utils/csvExport.js). Off while
// the list loads or has nothing to export.
// =============================================
export default function ExportButton({ onExport, count = null, disabled = false, className = '' }) {
  const off = disabled || count === 0
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={off}
      title={off ? 'Nothing to export' : `Download ${count === null ? 'this list' : `these ${count}`} as a CSV file (opens in Excel or Google Sheets)`}
      className={`inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <FontAwesomeIcon icon={faFileCsv} className="text-[#2D5A42]" />
      Export
    </button>
  )
}
