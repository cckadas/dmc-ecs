// client/services/pfiService.js

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generatePFI(quotation, items) {
  const doc = new jsPDF()

  doc.setFontSize(20)
  doc.text('PROFORMA INVOICE', 105, 20, {
    align: 'center',
  })

  doc.setFontSize(10)

  doc.text(
    `Quotation No.: ${quotation.quotation_number}`,
    20,
    35
  )

  doc.text(
    `Date: ${new Date(quotation.created_at).toLocaleDateString()}`,
    20,
    42
  )

  doc.text(
    `Expiry Date: ${new Date(
      quotation.expiry_date
    ).toLocaleDateString()}`,
    20,
    49
  )

  autoTable(doc, {
    startY: 60,
    head: [[
      'Product',
      'Quantity',
      'Unit',
      'Unit Price',
      'Subtotal',
    ]],
    body: items.map((item) => [
      item.product_name,
      item.quantity,
      item.unit,
      `₱${Number(item.unit_price).toLocaleString(
        undefined,
        { minimumFractionDigits: 2 }
      )}`,
      `₱${Number(
        item.quantity * item.unit_price
      ).toLocaleString(
        undefined,
        { minimumFractionDigits: 2 }
      )}`,
    ]),
  })

  const finalY = doc.lastAutoTable.finalY + 10

  doc.text(
    `Subtotal: ₱${Number(
      quotation.subtotal
    ).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    })}`,
    140,
    finalY
  )

  doc.text(
    `Shipping: ₱${Number(
      quotation.shipping_cost
    ).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    })}`,
    140,
    finalY + 7
  )

  doc.text(
    `Total: ₱${Number(
      quotation.total_amount
    ).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    })}`,
    140,
    finalY + 14
  )

  doc.text(
    `Down Payment: ₱${Number(
      quotation.down_payment_amount
    ).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    })}`,
    140,
    finalY + 21
  )

  return doc
}