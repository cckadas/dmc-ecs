// =====================================================
// PAYMENT MODAL
// =====================================================
function PaymentModal({ payment, onClose, onPaymentSubmitted }) {

  const amountDue = Number(payment.down_payment_amount || 0)

  const [selectedBank, setSelectedBank] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentFile, setPaymentFile] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)


  async function confirmPayment() {
    if (!selectedBank) {
      alert('Please select a bank.')
      return
    }

    if (!paymentAmount || Number(paymentAmount) <= 0) {
      alert('Please enter the amount paid.')
      return
    }

    if (!paymentFile) {
      alert('Please upload your payment confirmation.')
      return
    }

    const amount = Number(paymentAmount)

    if (amount > amountDue) {
      alert('The amount paid cannot exceed the amount due.')
      return
    }

    setIsSubmitting(true)

    try {
      // =============================================
      // UPLOAD PAYMENT PROOF
      // =============================================

      const fileExtension = paymentFile.name.split('.').pop()
      const fileName = `${payment.id}-${Date.now()}.${fileExtension}`
      const filePath = `payments/${fileName}`

      const { error: uploadError } = await supabase
        .storage
        .from('payment-proofs')
        .upload(filePath, paymentFile, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error(uploadError)
        alert('Failed to upload payment confirmation.')
        return
      }


      // =============================================
      // SAVE PAYMENT INFORMATION
      // =============================================
      const { error: updateError } = await supabase
        .from('customer_orders')
        .update({
          settled_amount: amount,
          payment_bank: selectedBank,
          payment_proof: filePath,
          status: 'submitted',
        })
        .eq('id', payment.id)

      if (updateError) {
        console.error(updateError)

        // Remove uploaded file if database update failed
        await supabase
          .storage
          .from('payment-proofs')
          .remove([filePath])

        alert('Failed to save payment information.')
        return
      }


      // =============================================
      // SUCCESS
      // =============================================
      await onPaymentSubmitted()
      onClose()
    }
    
    catch (error) {
      console.error(error)
      alert('Something went wrong while submitting the payment.')
    }
    
    finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b bg-[#F4F8F5] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">
              Payment
            </h2>

            <p className="text-sm text-gray-500">
              {payment.order_number || '-'}
            </p>
          </div>

          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
            title="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="h-5 w-5"/>
          </button>
        </div>


        <div className="flex-1 overflow-y-auto p-6">

          {/* Order Information */}
          <div className="mb-6 rounded-lg border bg-gray-50 p-5">
            <h3 className="mb-4 text-lg font-semibold text-[#1F3A2C]">
              Order Information
            </h3>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-500">
                  Order Number
                </p>

                <p className="font-semibold">
                  {payment.order_number || '-'}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">
                  Quotation Number
                </p>

                <p className="font-semibold">
                  {payment.quotation_number || '-'}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">
                  Status
                </p>

                <StatusBadge status={payment.status}/>
              </div>


              <div>
                <p className="text-sm text-gray-500">
                  Date Created
                </p>

                <p>
                  {new Date(payment.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>


          {/* Order Items Information */}
          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold text-[#1F3A2C]">
              Order Items
            </h3>

            <div className="overflow-hidden rounded-lg border">
              <div className="max-h-[400px] overflow-y-auto">
                <table className="min-w-full">

                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Product
                      </th>

                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Quantity
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Unit Price
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Subtotal
                      </th>
                    </tr>
                  </thead>


                  <tbody>
                    {payment.customer_order_items?.length > 0 ? (
                      payment.customer_order_items.map(
                        (item) => (
                          <tr key={item.id} className="border-t">
                            <td className="px-4 py-3">
                              {item.products?.product_name || '-'}
                            </td>

                            <td className="px-4 py-3">
                              {item.products?.brand || '-'}
                            </td>

                            <td className="px-4 py-3 text-center">
                              {item.quantity}
                            </td>

                            <td className="px-4 py-3 text-right">
                              ₱
                              {Number(
                                item.unit_price || 0
                              ).toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 2,
                                }
                              )}
                            </td>

                            <td className="px-4 py-3 text-right font-medium">
                              ₱
                              {Number(
                                item.subtotal || 0
                              ).toLocaleString(
                                undefined,
                                {
                                  minimumFractionDigits: 2,
                                }
                              )}
                            </td>
                          </tr>
                        )
                      )
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-sm text-gray-500">
                          No order items found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>


          {/* =====================================================
              PAYMENT SECTION
          ===================================================== */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

            {/* =====================================================
                PAYMENT SUMMARY
            ===================================================== */}
            <div className="rounded-lg border bg-gray-50 p-5">

              <h3 className="mb-5 text-lg font-semibold text-[#1F3A2C]">
                Payment Summary
              </h3>

              {/* SUBTOTAL */}
              <div className="mb-2 flex justify-between">
                <span className="text-gray-500">
                  Subtotal
                </span>

                <span>
                  ₱{' '}
                  {Number(
                    payment.subtotal || 0
                  ).toLocaleString(
                    undefined,
                    {
                      minimumFractionDigits: 2,
                    }
                  )}
                </span>
              </div>


              {/* SHIPPING */}
              <div className="mb-2 flex justify-between">
                <span className="text-gray-500">
                  Shipping
                </span>

                <span>
                  ₱{' '}
                  {Number(
                    payment.shipping_cost || 0
                  ).toLocaleString(
                    undefined,
                    {
                      minimumFractionDigits: 2,
                    }
                  )}
                </span>
              </div>


              {/* TOTAL */}
              <div className="mb-4 flex justify-between text-lg font-bold">
                <span>
                  Total
                </span>

                <span>
                  ₱{' '}
                  {Number(
                    payment.total_amount || 0
                  ).toLocaleString(
                    undefined,
                    {
                      minimumFractionDigits: 2,
                    }
                  )}
                </span>
              </div>


              <hr className="my-4" />


              {/* AMOUNT DUE */}
              <div className="flex justify-between text-lg font-bold">

                <span>
                  Amount Due
                </span>

                <span className="text-[#1F3A2C]">
                  ₱{' '}
                  {amountDue.toLocaleString(
                    undefined,
                    {
                      minimumFractionDigits: 2,
                    }
                  )}
                </span>

              </div>

            </div>


            {/* =====================================================
                MAKE PAYMENT
            ===================================================== */}
            <div className="rounded-lg border bg-gray-50 p-5">

              <h3 className="mb-5 text-lg font-semibold text-[#1F3A2C]">
                Make Payment
              </h3>


              {/* BANK */}
              <div className="mb-5">

                <p className="mb-2 text-sm font-medium text-gray-700">
                  Select Bank
                </p>

                <div className="flex flex-wrap gap-2">

                  {['BDO', 'Chinabank', 'Other'].map((bank) => (

                    <button
                      key={bank}
                      type="button"
                      onClick={() => setSelectedBank(bank)}
                      className={`
                        rounded-full
                        border
                        px-4
                        py-2
                        text-sm
                        font-medium
                        transition
                        ${
                          selectedBank === bank
                            ? 'border-[#1F3A2C] bg-[#1F3A2C] text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                        }
                      `}
                    >
                      {bank}
                    </button>

                  ))}

                </div>

              </div>


              {/* AMOUNT */}
              <div className="mb-5">

                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Amount Paid
                </label>

                <div className="relative">

                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                    ₱
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="0.00"
                    className="
                      w-full
                      rounded-lg
                      border
                      border-gray-300
                      bg-white
                      py-2.5
                      pl-8
                      pr-3
                      text-right
                      outline-none
                      focus:border-[#1F3A2C]
                      focus:ring-1
                      focus:ring-[#1F3A2C]
                    "
                  />

                </div>

              </div>


              {/* UPLOAD */}
              <div className="mb-5">

                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Payment Confirmation
                </label>

                <label
                  className="
                    flex
                    cursor-pointer
                    items-center
                    justify-center
                    rounded-lg
                    border-2
                    border-dashed
                    border-gray-300
                    bg-white
                    px-4
                    py-6
                    text-center
                    transition
                    hover:border-[#1F3A2C]
                    hover:bg-gray-50
                  "
                >

                  <div>

                    <p className="text-sm font-medium text-gray-700">
                      {paymentFile
                        ? paymentFile.name
                        : 'Upload payment confirmation'
                      }
                    </p>

                    <p className="mt-1 text-xs text-gray-400">
                      Image or PDF
                    </p>

                  </div>

                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      setPaymentFile(
                        e.target.files?.[0] || null
                      )
                    }}
                    className="hidden"
                  />

                </label>

              </div>


              {/* CONFIRM PAYMENT */}
              <button
                type="button"
                onClick={confirmPayment}
                disabled={
                  isSubmitting ||
                  !selectedBank ||
                  !paymentAmount ||
                  !paymentFile
                }
                className="
                  w-full
                  rounded-lg
                  bg-[#1F3A2C]
                  px-4
                  py-2.5
                  font-medium
                  text-white
                  hover:bg-[#2D5A42]
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              >
                {isSubmitting
                  ? 'Submitting Payment...'
                  : 'Confirm Payment'
                }
              </button>

            </div>
          </div>
        </div>


        {/* Footer */}
        <div className="flex justify-end border-t bg-gray-50 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-200 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}