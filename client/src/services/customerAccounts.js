import { authHeaders } from './apiAuth'

const API = `${import.meta.env.VITE_SERVER_URL}/api/customer-accounts`


// =============================================
// CLOSING A CUSTOMER'S ACCOUNT (db/migrations/038), admin only
// step: 'stop' (new orders), 'deactivate', 'activate' or 'delete'
// =============================================
async function call(method, customerId, step) {
  const response = await fetch(`${API}/${encodeURIComponent(customerId)}/${step}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
  })

  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Server returned invalid JSON (${response.status})`)
  }

  if (!response.ok) {
    const error = new Error(data.error || 'The account could not be changed.')
    error.result = data.result || null
    throw error
  }

  return data
}

// What the step would do: { allowed, refusal, cancel_orders, cancel_requests,
// withdraw_quotations, carry_on, payment_checks, balances, waiting_goods,
// records, erases, customer: { label, status } }.
export const previewAccountStep = (customerId, step) => call('GET', customerId, step)

// The step: { result, repeated, signInWarning }.
export const runAccountStep = (customerId, step) => call('POST', customerId, step)
