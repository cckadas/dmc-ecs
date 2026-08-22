import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logo from '../assets/logo.png'
import seal from '../assets/seal.png'



// ============================================================
// IMAGE HELPER
// Converts the imported Vite asset into a data URL for jsPDF
// ============================================================
async function getImageData(url) {
  const response = await fetch(url)
  const blob = await response.blob()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject

    reader.readAsDataURL(blob)
  })
}


// ============================================================
// FORMATTERS
// ============================================================
function formatCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}


function formatDate(value) {
  if (!value) return '-'

  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}


// ============================================================
// PFI GENERATOR
// ============================================================
export async function generatePFI(quotation, items) {
  const doc = new jsPDF()

  // ----------------------------------------------------------
  // COLORS
  // ----------------------------------------------------------
  const darkText = [55, 58, 72]
  const mutedText = [95, 99, 115]
  const lightBlue = [225, 239, 246]
  const borderColor = [145, 150, 160]
  const background = [255, 255, 255]


  // ----------------------------------------------------------
  // PAGE BACKGROUND
  // ----------------------------------------------------------
  doc.setFillColor(...background)
  doc.rect(0, 0, 210, 297, 'F')


  // ----------------------------------------------------------
  // HEADER
  // ----------------------------------------------------------
  doc.setTextColor(...darkText)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text('PROFORMA INVOICE', 20, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...mutedText)
  doc.text('A preliminary billing document issued for quotation', 20, 38)
  doc.text('order confirmation, and payment reference', 20, 44)


  // ----------------------------------------------------------
  // LOGO
  // Preserve original aspect ratio
  // ----------------------------------------------------------
  try {
    const logoData = await getImageData(logo)
    const image = new Image()
    image.src = logoData

    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
    })

    const logoWidth = 30
    const logoHeight = (image.height / image.width) * logoWidth

    const logoX = 168
    const logoY = 17

    doc.addImage(
      logoData,
      'PNG',
      logoX,
      logoY,
      logoWidth,
      logoHeight
    )
  }

  catch (error) {
    console.warn('Unable to load PFI logo:', error)

    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('DMC Enterprise', 145, 30)
  }


  // ==========================================================
  // BILLED BY
  // ==========================================================
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...darkText)
  doc.text('Billed by', 20, 62)


  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text('DMC Enterprise', 20, 70)
  doc.text('San Juan City, Metro Manila', 20, 76, { maxWidth: 48 })
  doc.text(`Email  ${quotation.profile_email || '-'}`, 20, 88)
  doc.text(`Phone  ${quotation.profile_phone || '-'}`, 20, 94)


  // ==========================================================
  // BILLED TO
  // ==========================================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)

  doc.text('Billed to', 82, 62)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    quotation.customer_name || quotation.customer?.name || '-',
    82,
    70
  )

  doc.text(
    quotation.customer_address ||
      quotation.customer?.address ||
      '-',
    82,
    76,
    {
      maxWidth: 48,
    }
  )

  doc.text(
    `Email  ${
      quotation.customer_email ||
      quotation.customer?.email ||
      '-'
    }`,
    82,
    88
  )

  doc.text(
    `Phone  ${
      quotation.customer_phone ||
      quotation.customer?.phone ||
      '-'
    }`,
    82,
    94
  )


  // ==========================================================
  // QUOTATION INFORMATION
  // ==========================================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...darkText)

  doc.text('Quotation No:', 145, 62)
  doc.text('Quotation Date:', 145, 69)
  doc.text('Expiry Date:', 145, 76)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...mutedText)

  doc.text(
    quotation.quotation_number || '-',
    178,
    62
  )

  doc.text(
    formatDate(quotation.created_at),
    178,
    69
  )

  doc.text(
    formatDate(quotation.expiry_date),
    178,
    76
  )


  // ----------------------------------------------------------
  // SHIPPING / TRANSPORT INFORMATION
  // ----------------------------------------------------------
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)


  // ==========================================================
  // SHIPPED FROM
  // ==========================================================
  doc.text('Shipped From', 20, 112)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    'DMC Warehouse, San Juan City, Metro Manila',
    20,
    122,
    {
      maxWidth: 48,
    }
  )


  // ==========================================================
  // SHIPPED TO
  // ==========================================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)

  doc.text('Shipped To', 82, 112)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    quotation.shipping_to ||
      quotation.customer_address ||
      quotation.customer?.address ||
      '-',
    82,
    122,
    {
      maxWidth: 48,
    }
  )


  // ==========================================================
  // TRANSPORT DETAILS
  // ==========================================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)

  doc.text('Transport Details', 145, 112)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    `Shipping: ${formatCurrency(
      quotation.shipping_cost
    )}`,
    145,
    122
  )

  doc.text(
    `Delivery: ${
      quotation.delivery_method || 'Standard'
    }`,
    145,
    129
  )


  // ----------------------------------------------------------
  // ITEMS TABLE
  // ----------------------------------------------------------
  autoTable(doc, {
    startY: 145,

    margin: {
      left: 20,
      right: 20,
    },

    head: [[
      'Service Description',
      'Qty.',
      'Unit',
      'Unit Price/Rate',
      'Tax Rate',
      'Tax Amount',
      'Total Amount',
    ]],

    body: items.map((item) => {
      const quantity = Number(item.quantity || 0)
      const unitPrice = Number(item.unit_price || 0)

      const subtotal =
        quantity * unitPrice

      const taxRate = Number(
        item.tax_rate ||
          quotation.tax_rate ||
          0
      )

      const taxAmount =
        subtotal * (taxRate / 100)

      const total =
        subtotal + taxAmount

      return [
        item.product_name || '-',
        quantity,
        item.unit || '-',
        formatCurrency(unitPrice),
        `${taxRate}%`,
        formatCurrency(taxAmount),
        formatCurrency(total),
      ]
    }),

    styles: {
      font: 'helvetica',
      fontSize: 7.5,
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
      fontSize: 7.5,
      lineColor: borderColor,
      lineWidth: 0.3,
    },

    alternateRowStyles: {
      fillColor: [250, 250, 252],
    },

    columnStyles: {
      0: {
        cellWidth: 52,
      },

      1: {
        cellWidth: 13,
        halign: 'center',
      },

      2: {
        cellWidth: 15,
        halign: 'center',
      },

      3: {
        cellWidth: 25,
        halign: 'right',
      },

      4: {
        cellWidth: 17,
        halign: 'center',
      },

      5: {
        cellWidth: 22,
        halign: 'right',
      },

      6: {
        cellWidth: 26,
        halign: 'right',
      },
    },

    didParseCell(data) {
      if (
        data.section === 'body' &&
        data.column.index === 0
      ) {
        const item = items[data.row.index]

        if (item.description) {
          data.cell.text = [
            item.product_name || '-',
            item.description,
          ]
        }
      }
    },
  })


  // ----------------------------------------------------------
  // TOTALS
  // ----------------------------------------------------------
  let finalY =
    doc.lastAutoTable.finalY + 10


  // Prevent totals from overflowing
  if (finalY > 245) {
    doc.addPage()

    doc.setFillColor(...background)
    doc.rect(
      0,
      0,
      210,
      297,
      'F'
    )

    finalY = 25
  }


  // ==========================================================
  // TERMS AND CONDITIONS
  // ==========================================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...darkText)

  doc.text(
    'Terms and Conditions',
    20,
    finalY
  )

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...mutedText)

  const terms =
    quotation.terms_and_conditions ||
    'This proforma invoice is subject to the agreed quotation terms and conditions.'

  doc.text(
    terms,
    20,
    finalY + 8,
    {
      maxWidth: 90,
    }
  )


  // ----------------------------------------------------------
  // TOTAL BOX
  // ----------------------------------------------------------
  const totalBoxX = 130
  const totalBoxY = finalY - 3
  const totalBoxWidth = 60
  const totalBoxHeight = 38

  doc.setDrawColor(...borderColor)
  doc.setLineWidth(0.3)

  doc.rect(
    totalBoxX,
    totalBoxY,
    totalBoxWidth,
    totalBoxHeight
  )


  // ==========================================================
  // SUBTOTAL
  // ==========================================================
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...darkText)

  doc.text(
    'Subtotal',
    totalBoxX + 4,
    totalBoxY + 8
  )

  doc.setFont('helvetica', 'normal')

  doc.text(
    formatCurrency(
      quotation.subtotal
    ),
    totalBoxX + totalBoxWidth - 4,
    totalBoxY + 8,
    {
      align: 'right',
    }
  )


  // ==========================================================
  // SHIPPING
  // ==========================================================
  doc.setFont('helvetica', 'bold')

  doc.text(
    'Shipping',
    totalBoxX + 4,
    totalBoxY + 16
  )

  doc.setFont('helvetica', 'normal')

  doc.text(
    formatCurrency(
      quotation.shipping_cost
    ),
    totalBoxX + totalBoxWidth - 4,
    totalBoxY + 16,
    {
      align: 'right',
    }
  )


  // ==========================================================
  // TOTAL
  // ==========================================================
  doc.setFont('helvetica', 'bold')

  doc.text(
    'Total',
    totalBoxX + 4,
    totalBoxY + 24
  )

  doc.text(
    formatCurrency(
      quotation.total_amount
    ),
    totalBoxX + totalBoxWidth - 4,
    totalBoxY + 24,
    {
      align: 'right',
    }
  )


  // ==========================================================
  // DOWN PAYMENT
  // ==========================================================
  doc.setFontSize(7.5)

  doc.text(
    'Down Payment',
    totalBoxX + 4,
    totalBoxY + 32
  )

  doc.setFont('helvetica', 'normal')

  doc.text(
    formatCurrency(
      quotation.down_payment_amount
    ),
    totalBoxX + totalBoxWidth - 4,
    totalBoxY + 32,
    {
      align: 'right',
    }
  )


  // ==========================================================
  // COMPANY SEAL
  // ==========================================================

  try {
    const sealData = await getImageData(seal)

    // Square seal
    const sealSize = 30

    // Position below the terms section
    const sealX = 20
    const sealY = finalY + 50

    doc.addImage(
      sealData,
      'PNG',
      sealX,
      sealY,
      sealSize,
      sealSize
    )

    // Label underneath
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...darkText)

    doc.text(
      'AUTHORIZED COMPANY SEAL',
      sealX + sealSize / 2,
      sealY + sealSize + 6,
      {
        align: 'center',
      }
    )

  }
  
  catch (error) {
    console.warn(
      'Unable to load company seal:',
      error
    )
  }


  // ----------------------------------------------------------
  // FOOTER
  // ----------------------------------------------------------
  doc.setFontSize(7)
  doc.setTextColor(
    130,
    133,
    145
  )

  doc.text(
    'This document is a proforma invoice and is not a final sales invoice.',
    105,
    285,
    {
      align: 'center',
    }
  )


  return doc
}