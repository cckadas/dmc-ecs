import { jsPDF } from 'jspdf'

import logo from '../assets/logo.png?inline'
import seal from '../assets/seal.png?inline'

// ============================================================
// FORMATTER
// ============================================================
function formatDate(value) {
  if (!value) return '-'

  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// ============================================================
// SHIPMENT DETAILS
// ============================================================
function getShipmentDetails(order) {
  const delivery =
    order.delivery_location ||
    order.delivery_locations ||
    {}

  return {
    orderNumber: order.order_number || '-',

    customerName:
      order.customer_name ||
      order.customer?.company ||
      order.customer?.name ||
      '-',

    destinationName:
      delivery.location_name ||
      order.shipping_location ||
      order.customer_name ||
      '-',

    destinationAddress:
      delivery.address ||
      order.customer_address ||
      order.shipping_to ||
      '-',

    destinationCountry:
      delivery.country ||
      order.customer_country ||
      '-',
  }
}

// ============================================================
// FORMAL CERTIFICATE LETTERHEAD
// Seal: upper left
// Logo: upper right
// ============================================================
function drawCertificateHeader(doc, title) {
  const darkText = [40, 40, 40]
  const mutedText = [85, 85, 85]
  const borderColor = [100, 100, 100]

  // White background
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, 210, 297, 'F')

  // ----------------------------------------------------------
  // LEFT SEAL
  // ----------------------------------------------------------
  try {
    const image = doc.getImageProperties(seal)

    const maxWidth = 20
    const maxHeight = 21

    const scale = Math.min(
      maxWidth / image.width,
      maxHeight / image.height
    )

    const width = image.width * scale
    const height = image.height * scale

    doc.addImage(
      seal,
      'PNG',
      20 + (20 - width) / 2,
      7 + (21 - height) / 2,
      width,
      height
    )
  } catch (error) {
    console.warn('Unable to load certificate seal:', error)
  }

  // ----------------------------------------------------------
  // RIGHT LOGO
  // ----------------------------------------------------------
  try {
    const image = doc.getImageProperties(logo)

    const maxWidth = 20
    const maxHeight = 21

    const scale = Math.min(
      maxWidth / image.width,
      maxHeight / image.height
    )

    const width = image.width * scale
    const height = image.height * scale

    doc.addImage(
      logo,
      'PNG',
      170 + (20 - width) / 2,
      7 + (21 - height) / 2,
      width,
      height
    )
  } catch (error) {
    console.warn('Unable to load certificate logo:', error)
  }

  // ----------------------------------------------------------
  // CENTERED COMPANY LETTERHEAD
  // ----------------------------------------------------------
  doc.setTextColor(...darkText)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)

  doc.text('DMC ENTERPRISE', 105, 12, {
    align: 'center',
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  doc.text('EXPORT CONSOLIDATION SYSTEM', 105, 18, {
    align: 'center',
  })

  doc.setFontSize(8)
  doc.setTextColor(...mutedText)

  doc.text(
    'San Juan City, Metro Manila, Philippines',
    105,
    24,
    { align: 'center' }
  )

  doc.text(
    'Export Operations and Fulfillment',
    105,
    29,
    { align: 'center' }
  )

  // ----------------------------------------------------------
  // DOUBLE DIVIDER
  // ----------------------------------------------------------
  doc.setDrawColor(...borderColor)
  doc.setLineWidth(0.45)
  doc.line(20, 36, 190, 36)

  doc.setLineWidth(0.2)
  doc.line(20, 37.5, 190, 37.5)

  // ----------------------------------------------------------
  // CENTERED CERTIFICATE TITLE
  // ----------------------------------------------------------
  doc.setTextColor(...darkText)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(title.length > 25 ? 17 : 19)

  doc.text(title, 105, 58, {
    align: 'center',
    maxWidth: 170,
  })
}

// ============================================================
// FORMAL BODY PARAGRAPH
// Uses a larger font and more generous line spacing.
// Returns the next available vertical position.
// ============================================================
function drawParagraph(doc, text, x, y, options = {}) {
  const {
    width = 170,
    fontSize = 12,
    lineHeight = 7,
    gapAfter = 0,
    color = [45, 45, 45],
  } = options

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  doc.setTextColor(...color)

  const lines = doc.splitTextToSize(text, width)

  doc.text(lines, x, y)

  return y + lines.length * lineHeight + gapAfter
}

// ============================================================
// AUTHORIZED COMPANY SEAL
// Positioned according to the amount of body text.
// ============================================================
function drawAuthorizationBlock(doc, bodyEndY = 190) {
  const centerX = 155
  const sealSize = 30

  // Keep the seal below the body while maintaining a bottom margin.
  const sealY = Math.min(
    Math.max(218, bodyEndY + 5),
    232
  )

  try {
    const image = doc.getImageProperties(seal)

    const scale = Math.min(
      sealSize / image.width,
      sealSize / image.height
    )

    const width = image.width * scale
    const height = image.height * scale

    doc.addImage(
      seal,
      'PNG',
      centerX - width / 2,
      sealY + (sealSize - height) / 2,
      width,
      height
    )

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(40, 40, 40)

    doc.text(
      'AUTHORIZED COMPANY SEAL',
      centerX,
      sealY + sealSize + 6,
      { align: 'center' }
    )
  } catch (error) {
    console.warn('Unable to load authorized company seal:', error)
  }
}

// ============================================================
// CERTIFICATE OF SHIPMENT BUILDER
// ============================================================
export function generateCertificateOfShipment(order, items) {
  const doc = new jsPDF()

  const { orderNumber } = getShipmentDetails(order)

  const issueDate = formatDate(new Date())
  const productLines = Array.isArray(items) ? items.length : 0

  // Letterhead and title
  drawCertificateHeader(doc, 'CERTIFICATE OF SHIPMENT')

  // ----------------------------------------------------------
  // SALUTATION
  // ----------------------------------------------------------
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(45, 45, 45)

  doc.text('To whom it may concern:', 20, 80)

  // ----------------------------------------------------------
  // CERTIFICATION STATEMENT
  // ----------------------------------------------------------
  let y = 96

  y = drawParagraph(
    doc,
    `THIS IS TO CERTIFY that Customer Order No. ${orderNumber} ` +
      `has been recorded in the internal records of DMC Enterprise ` +
      `as shipped on ${issueDate}, following the completion of the ` +
      `applicable order fulfillment and shipment preparation procedures. ` +
      `This certificate serves as a formal record of the shipment status ` +
      `documented in the system on the date indicated herein.`,
    20,
    y
  )

  y = drawParagraph(
    doc,
    `The corresponding order documentation contains ${productLines} ` +
      `distinct product line(s), with the associated product descriptions ` +
      `and recorded quantities detailed in the packing list prepared for ` +
      `the same order. The packing list should be used as the primary ` +
      `reference for reviewing the listed products and their quantities ` +
      `in conjunction with this Certificate of Shipment.`,
    20,
    y
  )

  y = drawParagraph(
    doc,
    `This document has been prepared to support the documentation and ` +
      `recordkeeping requirements associated with the order. The shipment ` +
      `information stated herein is based on the order records available ` +
      `when this certificate was generated and should be read together ` +
      `with the applicable shipment documents maintained by DMC Enterprise.`,
    20,
    y
  )

  // ----------------------------------------------------------
  // PREPARATION STATEMENT
  // ----------------------------------------------------------
  y = drawParagraph(
    doc,
    `PREPARED AND ISSUED on ${issueDate} by DMC Enterprise, ` +
      `San Juan City, Metro Manila, Philippines, for documentation ` +
      `and reference in connection with the shipment identified above.`,
    20,
    y,
    {
      width: 170,
      fontSize: 12,
      lineHeight: 7,
      gapAfter: 0,
    }
  )

  // Authorized seal at lower right
  drawAuthorizationBlock(doc, y)

  return doc
}

// ============================================================
// CERTIFICATE OF CLEARANCE BUILDER
// ============================================================
export function generateCertificateOfClearance(order, items) {
  const doc = new jsPDF()

  const { orderNumber } = getShipmentDetails(order)

  const issueDate = formatDate(new Date())
  const productLines = Array.isArray(items) ? items.length : 0

  // Letterhead and title
  drawCertificateHeader(doc, 'CERTIFICATE OF CLEARANCE')

  // ----------------------------------------------------------
  // SALUTATION
  // ----------------------------------------------------------
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(45, 45, 45)

  doc.text('To whom it may concern:', 20, 80)

  // ----------------------------------------------------------
  // CLEARANCE STATEMENT
  // ----------------------------------------------------------
  let y = 96

  y = drawParagraph(
    doc,
    `THIS IS TO CERTIFY that, according to the internal records ` +
      `maintained by DMC Enterprise, Customer Order No. ${orderNumber} ` +
      `has completed the applicable internal fulfillment procedures ` +
      `and has been recorded as cleared for dispatch on ${issueDate}. ` +
      `This clearance reflects the order's recorded operational status ` +
      `within the company's export consolidation and warehouse process.`,
    20,
    y
  )

  y = drawParagraph(
    doc,
    `The order documentation contains ${productLines} distinct product ` +
      `line(s). The corresponding packing list provides the recorded ` +
      `product descriptions and quantities associated with the order ` +
      `and serves as the supporting itemized document for reference. ` +
      `The clearance record should therefore be reviewed together with ` +
      `the packing list and other applicable order documentation.`,
    20,
    y
  )

  y = drawParagraph(
    doc,
    `This certificate is intended to document the internal operational ` +
      `clearance recorded by DMC Enterprise for its order fulfillment ` +
      `process. It confirms only the status represented in the company's ` +
      `internal records and should not be interpreted as evidence of ` +
      `government approval, customs release, or regulatory certification. ` +
      `Any separate permits, inspections, or clearances required by ` +
      `relevant authorities remain subject to their respective procedures.`,
    20,
    y,
    {
      width: 170,
      fontSize: 11,
      lineHeight: 6.5,
      gapAfter: 12,
      color: [70, 70, 70],
    }
  )

  // ----------------------------------------------------------
  // PREPARATION STATEMENT
  // ----------------------------------------------------------
  y = drawParagraph(
    doc,
    `PREPARED AND ISSUED on ${issueDate} by DMC Enterprise, ` +
      `San Juan City, Metro Manila, Philippines, for internal ` +
      `documentation and reference in connection with the order ` +
      `identified above.`,
    20,
    y,
    {
      width: 170,
      fontSize: 12,
      lineHeight: 7,
      gapAfter: 0,
    }
  )

  // Authorized seal at lower right
  drawAuthorizationBlock(doc, y)

  return doc
}