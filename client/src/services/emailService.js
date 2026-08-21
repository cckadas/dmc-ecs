const API = `${import.meta.env.VITE_SERVER_URL}/api`

export async function sendPurchaseOrderEmails(purchaseOrderId) {
  const response = await fetch(`${API}/send-email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        purchaseOrderId
      })
    }
  )

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(
      result.error ||
      'Failed to send Purchase Order emails.'
    )
  }

  return result
}