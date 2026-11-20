// =============================================================================
// Exporting a list as a CSV file
//
// What the page shows (after Show and Search, in its order), one row per
// record, as a file Excel and Google Sheets open as they are: UTF-8 with the
// byte-order mark Excel looks for (so ₱ and accented names come out right),
// commas between fields, quotes where needed. Numbers stay numbers, so they can
// be added up; dates are written in the Philippines' time as YYYY-MM-DD HH:MM.
//
// A cell that starts with = + - or @ would be run as a formula when the file is
// opened, so text like that (a name someone typed, say) gets a ' in front.
// Like the page itself, a file has only what the person exporting may see.
//
// columns: [{ header, value: (row) => string | number | null }]
// Pure, except downloadCsv (it needs a browser).
// =============================================================================

export const BOM = String.fromCharCode(0xfeff)

const FORMULA = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

// One field, as it goes in the file.
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  let text = String(value)
  if (FORMULA.test(text)) text = `'${text}`
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// The whole file: the header row, then a row per record.
export function csvText(columns, rows) {
  const lines = [
    columns.map((column) => csvCell(column.header)).join(','),
    ...(rows || []).map((row) => columns.map((column) => csvCell(column.value(row))).join(',')),
  ]
  return BOM + lines.join('\r\n') + '\r\n'
}

// Saves the file in the browser's downloads.
export function downloadCsv(fileName, columns, rows) {
  const blob = new Blob([csvText(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}


// Values for the columns ----------------------------------------------------------------

const manila = (value) => {
  if (value === null || value === undefined || value === '') return null
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time)) return null
  return new Date(time + 8 * 60 * 60 * 1000).toISOString()
}

// A moment, as YYYY-MM-DD HH:MM in the Philippines.
export const dateTime = (value) => {
  const iso = manila(value)
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : ''
}

// A day: a YYYY-MM-DD date as it is, or a moment's day in the Philippines.
export const day = (value) => {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value)
  const iso = manila(value)
  return iso ? iso.slice(0, 10) : ''
}

// An amount of money, as a number with 2 decimals (empty when there's none).
export const money = (value) =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 100) / 100

// A number, or empty.
export const number = (value) =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)

// A status as the badges write it ("Payment Rejected").
export const statusText = (status) =>
  String(status || '').trim().toLowerCase().split(' ').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

// The file's name: the list and today's date in the Philippines.
export const exportName = (list, now = Date.now()) => `${list}-${day(now)}.csv`

// An order's or request's products in one cell: "Lucky Me Noodles × 100 cases; ...".
export const productsText = (items, nameOf = (item) => item.products?.product_name, unitOf = (item) => item.products?.unit) =>
  (items || []).map((item) => `${nameOf(item) || 'Product'} × ${item.quantity ?? ''}${unitOf(item) ? ` ${unitOf(item)}` : ''}`).join('; ')
