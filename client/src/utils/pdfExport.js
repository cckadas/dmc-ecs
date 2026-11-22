import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logo from '../assets/logo.png'
import { dateTime, pdfCell, pdfText } from './csvExport.js'


// =============================================================================
// Exporting a list as a PDF
//
// The same rows and columns as the CSV (utils/csvExport.js), on A4 with DMC's
// logo and details at the top of every page, the list's name, how many rows,
// when and by whom it was exported, and page numbers. Landscape when the list
// is wide. A column marked pdf: false stays in the CSV only (for the widest
// lists, so the PDF stays readable on paper). Needs a browser.
// =============================================================================

const GREEN = [45, 90, 66]       // #2D5A42, the website's green
const DARK = [31, 58, 44]        // #1F3A2C
const MUTED = [100, 106, 115]
const LIGHT = [244, 248, 245]    // #F4F8F5
const LINES = [220, 224, 228]

let logoData = null

// DMC's logo as a data URL, loaded once, at 240 px (sharp at the 16 mm it's
// printed, and a fraction of the full 512 px file's size in every PDF).
async function loadLogo() {
  if (logoData) return logoData
  const image = new Image()
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
    image.src = logo
  })

  const size = 240
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = Math.round((image.height / image.width) * size)
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  logoData = canvas.toDataURL('image/png')
  return logoData
}

export async function downloadPdf(fileName, title, columns, rows, { by = null } = {}) {
  const shown = columns.filter((column) => column.pdf !== false)
  const list = rows || []
  const landscape = shown.length > 7
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const exportedAt = dateTime(Date.now())

  let image = null
  try {
    image = await loadLogo()
  } catch (error) {
    console.warn('DMC logo could not be loaded for the PDF:', error)
  }

  // DMC's logo and details on the left, the list on the right, a green rule.
  const header = () => {
    if (image) doc.addImage(image, 'PNG', 12, 8, 16, 16, 'dmc-logo', 'FAST')
    const textX = image ? 31 : 12

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...DARK)
    doc.text('DMC Enterprise', textX, 14)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text('San Juan City, Metro Manila', textX, 19)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...DARK)
    doc.text(pdfText(title), width - 12, 14, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(
      pdfText(`${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'row' : 'rows'}, as listed · exported ${exportedAt} (Manila)${by ? ` by ${by}` : ''}`),
      width - 12, 19, { align: 'right' })

    doc.setDrawColor(...GREEN)
    doc.setLineWidth(0.4)
    doc.line(12, 27, width - 12, 27)
  }

  // Numbers line up on the right.
  const columnStyles = {}
  shown.forEach((column, index) => {
    const first = list.map((row) => column.value(row)).find((value) => value !== null && value !== undefined && value !== '')
    if (typeof first === 'number') columnStyles[index] = { halign: 'right' }
  })

  autoTable(doc, {
    head: [shown.map((column) => pdfText(column.header))],
    body: list.length
      ? list.map((row) => shown.map((column) => pdfCell(column.value(row), column.header)))
      : [[{ content: 'Nothing to show.', colSpan: shown.length, styles: { halign: 'center', textColor: MUTED } }]],
    startY: 31,
    margin: { top: 31, left: 12, right: 12, bottom: 14 },
    styles: {
      font: 'helvetica',
      fontSize: landscape ? 7 : 8,
      cellPadding: 1.5,
      overflow: 'linebreak',
      valign: 'top',
      textColor: [40, 40, 40],
      lineColor: LINES,
      lineWidth: 0.1,
    },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', valign: 'middle' },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles,
    didDrawPage: header,
  })

  // Page numbers, once the number of pages is known.
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text('DMC Export Consolidation System', 12, height - 7)
    doc.text(`Page ${page} of ${pages}`, width - 12, height - 7, { align: 'right' })
  }

  doc.save(fileName)
}
