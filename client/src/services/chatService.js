import { supabase } from '../supabase'

const API = `${import.meta.env.VITE_SERVER_URL}/api`


// Asks DMC Concierge on the server. The customer's session token tells the
// server who is asking, so it only ever looks up their own orders. Every
// failure becomes a message that can be shown in the chat.
export async function askAssistant({ message, history }) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token

  if (!token) {
    throw new Error('Your session has ended. Please sign in again.')
  }

  let response

  try {
    response = await fetch(`${API}/customer/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, history }),
    })
  } catch {
    throw new Error('I can\'t connect right now. Please try again in a moment.')
  }

  const result = await response.json().catch(() => ({}))

  if (!response.ok || !result.reply) {
    throw new Error(result.error || 'Something went wrong. Please try again.')
  }

  return result
}
