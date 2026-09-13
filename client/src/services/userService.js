const API = `${import.meta.env.VITE_SERVER_URL}/api`


// =============================================
// CREATE CUSTOMER
// =============================================
export async function createCustomer(customer) {
  const response = await fetch(`${API}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(customer),
  })

  const text = await response.text()

  // eslint-disable-next-line no-useless-assignment
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


// =============================================
// CREATE STAFF
// =============================================
export async function createStaffAccount(staff) {
  const response = await fetch(`${API}/staffs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(staff),
  })

  const text = await response.text()

  // eslint-disable-next-line no-useless-assignment
  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(
      `Server returned invalid JSON (${response.status})`
    )
  }

  if (!response.ok) {
    throw new Error(
      data.error || 'Failed to create staff account'
    )
  }

  return data
}


// =============================================
// ACTIVATE / DEACTIVATE STAFF
// =============================================
export async function updateStaffAccountStatus(
  id,
  isActive
) {
  const response = await fetch(
    `${API}/staffs/${id}/status`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isActive,
      }),
    }
  )

  const text = await response.text()

  // eslint-disable-next-line no-useless-assignment
  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(
      `Server returned invalid JSON (${response.status})`
    )
  }

  if (!response.ok) {
    throw new Error(
      data.error || 'Failed to update account status'
    )
  }

  return data
}