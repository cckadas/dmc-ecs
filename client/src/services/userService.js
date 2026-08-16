const API = `${import.meta.env.VITE_SERVER_URL}/api`

export async function createCustomer(customer) {
  const response = await fetch(`${API}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(customer),
  })

  const text = await response.text()

  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(
      `Server returned invalid JSON (${response.status})`
    )
  }

  if (!response.ok) {
    throw new Error(data.error || 'Failed to create customer')
  }

  return data
}