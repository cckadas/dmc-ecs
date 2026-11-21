import { supabase } from '../supabase'


// =============================================================================
// Credit limit
//
// A customer's unpaid balance is what they still owe on all their orders.
// Once it reaches DMC's credit limit, they can't send new quotation requests
// or approve quotations until they pay. The database enforces this too
// (db/migrations/002_credit_limit.sql); these helpers let the screens show it
// before anyone tries.
// =============================================================================

export async function getCreditStatus(customerId) {
  const { data, error } = await supabase.rpc('credit_status', {
    p_customer_id: customerId,
  })

  if (error) throw error

  const row = data?.[0]

  return {
    outstanding: Number(row?.outstanding || 0),
    creditLimit: row?.credit_limit == null ? null : Number(row.credit_limit),
    blocked: Boolean(row?.blocked),
  }
}


export async function getCreditLimit() {
  const { data, error } = await supabase
    .from('business_settings')
    .select('value')
    .eq('key', 'credit_limit')
    .maybeSingle()

  if (error) throw error

  return data?.value == null ? null : Number(data.value)
}


export async function saveCreditLimit(value, userId) {
  const { error } = await supabase
    .from('business_settings')
    .upsert(
      {
        key: 'credit_limit',
        value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    )

  if (error) throw error
}


// How much more the customer may owe before reaching the limit (Infinity when
// no limit is set).
export const creditRoom = (status) => (status?.creditLimit == null
  ? Infinity
  : Math.max(status.creditLimit - Number(status.outstanding || 0), 0))

// An order of this total would take the customer over the limit: by how much
// (0 when it fits). Approving it is refused, and sending its quotation is held
// (db/migrations/040).
export const overLimitBy = (status, total) => (status?.creditLimit == null
  ? 0
  : Math.max(Number(status.outstanding || 0) + Number(total || 0) - status.creditLimit, 0))


export function formatPeso(value) {
  return `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}


// Explains the most likely failure: the database script hasn't been run yet.
export function creditErrorMessage(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`

  if (/PGRST20[25]|42P01|42883|does not exist|could not find/i.test(text)) {
    return 'Credit limits are not set up in the database yet — run db/migrations/002_credit_limit.sql in Supabase.'
  }

  return error?.message || 'Could not load the credit limit.'
}
