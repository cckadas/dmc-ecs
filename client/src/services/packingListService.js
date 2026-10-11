import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

import logo from '../assets/logo.png?inline'
import seal from '../assets/seal.png?inline'

// ============================================================
// FORMATTER
// ============================================================
function formatDate(value) {
  if (!value) return '-'

  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ============================================================
// PACKING LIST GENERATOR
// ============================================================
export function generatePackingList(order, items) {
  const doc = new jsPDF()

  // COLORS — MATCH PFI
  const darkText = [55, 58, 72]
  const mutedText = [95, 99, 115]
  const lightBlue = [225, 239, 246]
  const borderColor = [145, 150, 160]
  const background = [255, 255, 255]

  // ==========================================================
  // PAGE BACKGROUND
  // ==========================================================
  doc.setFillColor(...background)
  doc.rect(0, 0, 210, 297, 'F')

  // ==========================================================
  // HEADER
  // ==========================================================
  doc.setTextColor(...darkText)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text('PACKING LIST', 20, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...mutedText)
  doc.text('Shipment Contents and Packing Details', 20, 38)
  doc.text('Export documentation for shipment preparation', 20, 44)

  // ==========================================================
  // COMPANY LOGO
  // ==========================================================
  try {
    const logoProperties = doc.getImageProperties(logo)
    const logoWidth = 30
    const logoHeight =
      (logoProperties.height / logoProperties.width) * logoWidth

    doc.addImage(
      logo,
      'PNG',
      168,
      17,
      logoWidth,
      logoHeight
    )
  } catch (error) {
    console.warn('Unable to load packing list logo:', error)

    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...darkText)
    doc.text('DMC Enterprise', 145, 30)
  }

  // ==========================================================
  // SHIPMENT INFORMATION
  // ==========================================================


  // SHIPPED FROM
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)
  doc.text('Shipped From', 20, 65)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    ['DMC Warehouse', 'San Juan City, Metro Manila'],
    20,
    75
  )

  // SHIPMENT DETAILS
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)
  doc.text('Shipment Details', 82, 65)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    `Order No.: ${order.order_number || '-'}`,
    82,
    75
  )

  doc.text(
    `Packing List: PL-${order.order_number || '-'}`,
    82,
    83
  )

  doc.text(
    `Date Generated: ${formatDate(new Date())}`,
    82,
    91
  )

  // ==========================================================
  // ITEMS TABLE
  // ==========================================================
  autoTable(doc, {
    startY: 115,

    margin: {
      left: 20,
      right: 20,
      bottom: 35,
    },

    head: [[
      '#',
      'SKU',
      'Product Description',
      'Quantity',
      'Unit',
    ]],

    body: items.map((item, index) => [
      index + 1,
      item.product?.sku || item.product_id || '-',
      item.product?.product_name || 'Unknown Product',
      item.received_quantity ?? 0,
      item.product?.unit || '-',
    ]),

    styles: {
      font: 'helvetica',
      fontSize: 8,
      textColor: darkText,
      lineColor: borderColor,
      lineWidth: 0.25,
      cellPadding: 4,
      valign: 'middle',
    },

    headStyles: {
      fillColor: lightBlue,
      textColor: darkText,
      fontStyle: 'bold',
      fontSize: 8,
      lineColor: borderColor,
      lineWidth: 0.3,
    },

    alternateRowStyles: {
      fillColor: [250, 250, 252],
    },

    columnStyles: {
      0: {
        cellWidth: 10,
        halign: 'center',
      },
      1: {
        cellWidth: 25,
      },
      2: {
        cellWidth: 80,
      },
      3: {
        cellWidth: 25,
        halign: 'center',
      },
      4: {
        cellWidth: 30,
        halign: 'center',
      },
    },
  })

  // ==========================================================
  // SUMMARY
  // ==========================================================
  let finalY = doc.lastAutoTable.finalY + 10

  // Reserve enough space for the company seal.
  // Move the seal to a separate page if necessary.
  if (finalY > 220) {
    doc.addPage()

    doc.setFillColor(...background)
    doc.rect(0, 0, 210, 297, 'F')

    finalY = 35
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)

  doc.text(
    `Total Product Lines: ${items.length}`,
    20,
    finalY
  )

  // ==========================================================
  // COMPANY SEAL
  // ==========================================================
  try {
    const sealSize = 30
    const sealX = 20
    const sealY = finalY + 50

    doc.addImage(
      seal,
      'PNG',
      sealX,
      sealY,
      sealSize,
      sealSize
    )

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...darkText)

    doc.text(
      'AUTHORIZED COMPANY SEAL',
      sealX + sealSize / 2,
      sealY + sealSize + 6,
      { align: 'center' }
    )
  } catch (error) {
    console.warn('Unable to load company seal:', error)
  }

  // ==========================================================
  // FOOTER ON EVERY PAGE
  // ==========================================================
  const pageCount = doc.internal.getNumberOfPages()

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(130, 133, 145)

    doc.text(
      'DMC Enterprise | Packing List',
      105,
      285,
      { align: 'center' }
    )
  }

  return doc
}