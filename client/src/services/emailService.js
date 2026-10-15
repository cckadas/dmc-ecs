const API = `${import.meta.env.VITE_SERVER_URL}/api`


// Posts to the email server and turns every failure into a readable message.
// Callers treat a thrown error as "the email wasn't sent", never as "the
// record wasn't saved" — the record is always saved before this is called.
async function postToServer(path, body, fallbackMessage) {
  let response

  try {
    response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('could not reach the server — make sure it is running')
  }

  const result = await response.json().catch(() => ({}))

  // The server answers 207 with success: false when only some supplier
  // emails failed; its message explains which.
  if (!response.ok || !result.success) {
    throw new Error(result.error || result.message || fallbackMessage)
  }

  return result
}


export async function sendPurchaseOrderEmails(purchaseOrderId) {
  return postToServer(
    '/send-email',
    { purchaseOrderId },
    'Failed to send Purchase Order emails.'
  )
}


export async function sendPaymentProof(supplierId, paymentProofPath) {
  return postToServer(
    '/send-payment-proof',
    { supplierId, paymentProofPath },
    'Failed to send Payment Proof emails.'
  )
}
