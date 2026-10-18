// Minimal CSV reader (RFC 4180): quoted fields, commas and line breaks inside
// quotes, and doubled quotes. Returns an array of rows, each an array of
// strings, with blank lines dropped. Files are read in the browser and never
// uploaded.
// Byte-order mark: Excel puts one at the start of UTF-8 CSV files.
export const BOM = String.fromCharCode(0xfeff)

export function parseCsv(text) {
  const source = text.startsWith(BOM) ? text.slice(1) : text
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]

    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}


// Builds CSV text from rows of values, quoting where needed.
export function toCsv(rows) {
  return rows
    .map((cells) =>
      cells
        .map((value) => {
          const text = value == null ? '' : String(value)
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
        })
        .join(',')
    )
    .join('\r\n')
}
