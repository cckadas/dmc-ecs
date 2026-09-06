import express from 'express'
import nodemailer from 'nodemailer'
import { supabaseAdmin } from '../supabaseAdmin.js'

const router = express.Router()

router.post('/', async (req, res) => {
  try {
    const {
      supplierId,
      paymentProofPath,
    } = req.body

    if (!supplierId) {
      return res.status(400).json({
        error: 'Supplier ID is required.',
      })
    }

    if (!paymentProofPath) {
      return res.status(400).json({
        error: 'Payment proof path is required.',
      })
    }

    // =========================================
    // GET SUPPLIER
    // =========================================

    const { data: supplier, error: supplierError } =
      await supabaseAdmin
        .from('suppliers')
        .select(`
          id,
          supplier_name,
          email
        `)
        .eq('id', supplierId)
        .single()

    if (supplierError) {
      throw supplierError
    }

    if (!supplier?.email) {
      return res.status(400).json({
        error: 'Supplier does not have an email address.',
      })
    }

    // =========================================
    // DOWNLOAD PAYMENT PROOF FROM STORAGE
    // =========================================

    const { data: file, error: downloadError } =
      await supabaseAdmin.storage
        .from('payment-proofs')
        .download(paymentProofPath)

    if (downloadError) {
      throw downloadError
    }

    // Convert Blob → Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // =========================================
    // CREATE EMAIL TRANSPORTER
    // =========================================

    const transporter = nodemailer.createTransport({
      service: 'gmail',

      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })

    // =========================================
    // SEND EMAIL
    // =========================================

    await transporter.sendMail({
      from: `"DMC Enterprise" <${process.env.GMAIL_USER}>`,

      to: supplier.email,

      subject: 'Payment Confirmation',

      html: `
        <div style="
          font-family: Arial, Helvetica, sans-serif;
          padding: 30px;
        ">
          <h2>Payment Confirmation</h2>

          <p>
            Dear ${supplier.supplier_name},
          </p>

          <p>
            DMC Enterprise has completed the payment
            for your purchase order.
          </p>

          <p>
            Please see the attached payment proof
            for your reference.
          </p>

          <p>
            Thank you.
          </p>

          <p>
            <strong>DMC Enterprise</strong><br>
            Procurement Department
          </p>
        </div>
      `,

      attachments: [
        {
          filename: paymentProofPath.split('/').pop(),
          content: buffer,
        },
      ],
    })

    return res.status(200).json({
      success: true,
      message: 'Payment proof email sent successfully.',
    })

  } catch (error) {
    console.error(
      'Send payment proof email error:',
      error
    )

    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error.',
    })
  }
})

export default router