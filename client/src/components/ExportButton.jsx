import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faFileCsv, faFileExport, faFilePdf } from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'


// =============================================
// EXPORT
//
// Downloads what the list shows, as a CSV file (for Excel or Google Sheets) or
// a PDF with DMC's logo (to print or share): utils/csvExport.js exportList.
// onExport({ format, by }) is called with the choice and who is exporting.
// Off while the list loads or has nothing to export.
// =============================================
export default function ExportButton({ onExport, count = null, disabled = false, className = '' }) {
  const { profile } = useAuth()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  const off = disabled || count === 0 || busy

  // A click elsewhere, or Escape, closes the menu.
  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => { if (!box.current?.contains(event.target)) setOpen(false) }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function exportAs(format) {
    setOpen(false)
    setBusy(true)
    try {
      const by = profile?.name ? `${profile.name}${profile.role ? ` (${profile.role})` : ''}` : null
      await onExport({ format, by })
    } catch (error) {
      console.error(`Export as ${format} failed:`, error)
      toast.error(`The ${format.toUpperCase()} file could not be made. Please try again.`)
    } finally {
      setBusy(false)
    }
  }

  const choice = 'flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-gray-50'

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={off}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled || count === 0 ? 'Nothing to export' : `Download ${count === null ? 'this list' : `these ${count}`} as a CSV or PDF file`}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FontAwesomeIcon icon={faFileExport} className="text-[#2D5A42]" />
        {busy ? 'Exporting...' : 'Export'}
        <FontAwesomeIcon icon={faChevronDown} className="h-3 w-3 text-gray-400" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg">
          <button type="button" role="menuitem" onClick={() => exportAs('csv')} className={choice}>
            <FontAwesomeIcon icon={faFileCsv} className="mt-0.5 text-[#2D5A42]" />
            <span>
              <span className="block font-medium text-gray-800">CSV file</span>
              <span className="block text-xs text-gray-500">For Excel or Google Sheets: sort, filter, add up</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => exportAs('pdf')} className={`${choice} border-t border-gray-100`}>
            <FontAwesomeIcon icon={faFilePdf} className="mt-0.5 text-[#2D5A42]" />
            <span>
              <span className="block font-medium text-gray-800">PDF file</span>
              <span className="block text-xs text-gray-500">With DMC's logo: to print or share</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
