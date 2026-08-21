import express from 'express'
import nodemailer from 'nodemailer'
import { supabaseAdmin } from '../supabaseAdmin.js'

const router = express.Router()

// =====================================================
// SEND PURCHASE ORDER EMAILS TO SUPPLIERS
// =====================================================

router.post('/', async (req, res) => {
  try {

    const { purchaseOrderId } = req.body

    if (!purchaseOrderId) {
      return res.status(400).json({
        error: 'Purchase Order ID is required.',
      })
    }


    // =================================================
    // GET PURCHASE ORDER
    // =================================================
    const { data: purchaseOrder, error: purchaseOrderError } = await supabaseAdmin
      .from('purchase_orders')
      .select(`
        id,
        po_number,
        status,
        issued_date,
        expected_delivery_date,
        created_at
      `)
      .eq('id', purchaseOrderId)
      .single()

    if (purchaseOrderError) {
      console.error(purchaseOrderError)

      return res.status(400).json({
        error: purchaseOrderError.message,
      })
    }


    // =================================================
    // GET PURCHASE ORDER ITEMS
    // =================================================
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('purchase_order_items')
      .select(`
        id,
        supplier_id,
        ordered_quantity,
        unit_price,

        products (
          product_name,
          unit
        ),

        suppliers (
          supplier_name,
          email
        )
      `)
      .eq('purchase_order_id', purchaseOrderId)

    if (itemsError) {
      console.error(itemsError)

      return res.status(400).json({
        error: itemsError.message,
      })
    }


    if (!items || items.length === 0) {
      return res.status(400).json({
        error: 'No items found for this Purchase Order.',
      })
    }


    // =================================================
    // GROUP ITEMS BY SUPPLIER
    // =================================================
    const supplierItems = {}

    for (const item of items) {
      if (!item.supplier_id) {
        continue
      }

      if (!supplierItems[item.supplier_id]) {
        supplierItems[item.supplier_id] = []
      }

      supplierItems[item.supplier_id].push(item)
    }


    // =================================================
    // CREATE EMAIL TRANSPORTER
    // =================================================
    const transporter = nodemailer.createTransport({
      service: 'gmail',

      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })


    // =================================================
    // FORMAT DATE
    // =================================================
    const formatDate = (date) => {
      if (!date) {
        return 'N/A'
      }

      return new Date(date).toLocaleDateString(
        'en-PH',
        {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }
      )
    }


    // =================================================
    // SEND EMAIL TO EACH SUPPLIER
    // =================================================
    const results = []

    for (const [supplierId, supplierProducts] of Object.entries(supplierItems)) {

      const supplier = supplierProducts[0]?.suppliers


      // -------------------------------------------------
      // VALIDATE SUPPLIER
      // -------------------------------------------------
      if (!supplier) {
        results.push({
          supplier_id: supplierId,
          success: false,
          error: 'Supplier not found.',
        })

        continue
      }


      if (!supplier.email) {
        results.push({
          supplier_id: supplierId,
          supplier_name: supplier.supplier_name,
          success: false,
          error: 'Supplier does not have an email address.',
        })

        continue
      }


      // -------------------------------------------------
      // CREATE PRODUCT ROWS
      // -------------------------------------------------
      const rows = supplierProducts.map((item) =>
          `
            <tr>

              <td style="
                border:1px solid #ddd;
                padding:10px;
              ">
                ${item.products?.product_name ?? 'Unknown Product'}
              </td>

              <td style="
                border:1px solid #ddd;
                padding:10px;
                text-align:center;
              ">
                ${item.ordered_quantity}
              </td>

              <td style="
                border:1px solid #ddd;
                padding:10px;
                text-align:center;
              ">
                ${item.products?.unit ?? '-'}
              </td>

            </tr>
          `
        ).join('')


      // -------------------------------------------------
      // SEND EMAIL
      // -------------------------------------------------
      try {

        await transporter.sendMail({
          from: `"DMC Enterprise" <${process.env.GMAIL_USER}>`,
          to: supplier.email,
          subject: `Purchase Order ${purchaseOrder.po_number}`,
          html:
          `
            <div style="
              font-family:Arial,Helvetica,sans-serif;
              background:#f5f5f5;
              padding:30px;
            ">

              <div style="
                max-width:750px;
                margin:auto;
                background:white;
                border-radius:8px;
                padding:35px;
              ">

                <h2 style="
                  margin-top:0;
                  color:#222;
                ">
                  Purchase Order
                </h2>


                <p>
                  Dear
                  <strong>
                    ${supplier.supplier_name}
                  </strong>,
                </p>


                <p>
                  DMC Enterprise has created a new Purchase Order
                  for your company.
                  Please prepare the items listed below.
                </p>


                <!-- =========================================== -->
                <!-- PURCHASE ORDER INFORMATION -->
                <!-- =========================================== -->

                <table style="
                  width:100%;
                  margin:25px 0;
                  border-collapse:collapse;
                ">

                  <tr>

                    <td style="padding:8px;">
                      <strong>
                        Purchase Order No.
                      </strong>
                    </td>

                    <td style="padding:8px;">
                      ${purchaseOrder.po_number}
                    </td>

                  </tr>


                  <tr>

                    <td style="padding:8px;">
                      <strong>
                        Issued Date
                      </strong>
                    </td>

                    <td style="padding:8px;">
                      ${formatDate(
                        purchaseOrder.issued_date ||
                        purchaseOrder.created_at
                      )}
                    </td>

                  </tr>


                  <tr>

                    <td style="padding:8px;">
                      <strong>
                        Expected Delivery
                      </strong>
                    </td>

                    <td style="padding:8px;">
                      ${formatDate(
                        purchaseOrder.expected_delivery_date
                      )}
                    </td>

                  </tr>


                  <tr>

                    <td style="padding:8px;">
                      <strong>
                        Status
                      </strong>
                    </td>

                    <td style="padding:8px;">
                      ${purchaseOrder.status}
                    </td>

                  </tr>

                </table>


                <!-- =========================================== -->
                <!-- PRODUCTS -->
                <!-- =========================================== -->

                <h3>
                  Products Requested
                </h3>


                <table style="
                  width:100%;
                  border-collapse:collapse;
                ">

                  <thead>

                    <tr style="
                      background:#222;
                      color:white;
                    ">

                      <th style="
                        padding:10px;
                        border:1px solid #ddd;
                        text-align:left;
                      ">
                        Product
                      </th>

                      <th style="
                        padding:10px;
                        border:1px solid #ddd;
                      ">
                        Quantity
                      </th>

                      <th style="
                        padding:10px;
                        border:1px solid #ddd;
                      ">
                        Unit
                      </th>

                    </tr>

                  </thead>


                  <tbody>

                    ${rows}

                  </tbody>

                </table>


                <p style="
                  margin-top:30px;
                ">
                  Please ensure that the products are delivered
                  to the DMC Enterprise warehouse together with
                  the corresponding delivery receipt.
                </p>


                <p>
                  If you anticipate any delays or are unable to
                  fulfill the order completely, please reply to
                  this email so we can coordinate accordingly.
                </p>


                <hr style="
                  margin:35px 0;
                ">


                <p>
                  Thank you for your continued partnership.
                </p>


                <p>
                  <strong>DMC Enterprise</strong><br>
                  Procurement Department
                </p>

              </div>

            </div>
          `,
        })

        results.push({
          supplier_id: supplierId,
          supplier_name: supplier.supplier_name,
          email: supplier.email,
          success: true,
          item_count: supplierProducts.length,
        })
      } 
      
      catch (emailError) {
        console.error('Failed to send PO email to ${supplier.email}:', emailError)

        results.push({
          supplier_id: supplierId,
          supplier_name: supplier.supplier_name,
          email: supplier.email,
          success: false,
          error: emailError.message,
        })
      }
    }


    // =================================================
    // RESPONSE
    // =================================================
    const failed = results.filter(
      (result) => !result.success
    )

    return res.status(failed.length > 0 ? 207 : 200).json({
      success: failed.length === 0,
      message: failed.length === 0
          ? 'Purchase Order emails sent successfully.'
          : 'Purchase Order created, but some supplier emails failed.',

      results,
    })
  } 
  
  catch (error) {
    console.error('Send Purchase Order email error:', error)

    return res.status(500).json({
      error: 'Internal server error.',
    })
  }
})

export default router