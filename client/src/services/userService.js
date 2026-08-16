const API = 'http://localhost:3001/api'

export async function createCustomer(customer) {
  const response = await fetch(`${API}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(customer),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error)
  }

  return data
}