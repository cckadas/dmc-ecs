import { supabase } from '../supabase'


// =============================================================================
// Credit limit
//
// A customer's unpaid balance is what they still owe on all their orders.
// Once it reaches DMC's credit limit, they can't send new quotation requests
// or approve quotations until they pay. The database enforces this too
// (db/migrations/002_credit_limit.sql); these helpers let the screens show it
// before anyone tries.
//
// Credit is DMC's to give, customer by customer (db/migrations/047): with it, a
// customer may owe up to their own limit; without it (every new customer), they
// have one unpaid order at a time, and each order ships once it's paid in full.
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
    // Before 047 is run, everyone has credit, under DMC's one limit.
    hasCredit: row?.has_credit == null ? true : Boolean(row.has_credit),
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


// Admin gives a customer credit with their own limit, changes it, or removes
// it (hasCredit false). Returns { changed, kind, ... } (db/migrations/047).
export async function setCustomerCredit(customerId, hasCredit, limit) {
  const { data, error } = await supabase.rpc('set_customer_credit', {
    p_customer_id: customerId,
    p_has_credit: hasCredit,
    p_limit: hasCredit ? limit : null,
  })
  if (error) throw error
  return data
}

// The latest changes to a customer's credit, newest first.
export async function getCreditChanges(customerId) {
  const { data, error } = await supabase
    .from('customer_credit_changes')
    .select('id, kind, credit_limit, previous_limit, owed_then, changed_at, changed_by_name')
    .eq('customer_id', customerId)
    .order('changed_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data || []
}

// How much more the customer may owe before reaching the limit (Infinity when
// no limit is set).
export const creditRoom = (status) => {
  // Without credit (047): room for one order, once nothing is owed.
  if (status?.hasCredit === false) return Number(status.outstanding || 0) > 0.009 ? 0 : Infinity

  return status?.creditLimit == null
    ? Infinity
    : Math.max(status.creditLimit - Number(status.outstanding || 0), 0)
}

// An order of this total would take the customer over the limit: by how much
// (0 when it fits). Approving it is refused, and sending its quotation is held
// (db/migrations/040).
export const overLimitBy = (status, total) => {
  // Without credit (047): everything still owed has to be paid first.
  if (status?.hasCredit === false) return Number(status.outstanding || 0) > 0.009 ? Number(status.outstanding) : 0

  return status?.creditLimit == null
    ? 0
    : Math.max(Number(status.outstanding || 0) + Number(total || 0) - status.creditLimit, 0)
}


export function formatPeso(value) {
  return `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Customers' money (balances, credit limits) is in US dollars (db/migrations/048).
export { formatUsd } from '../utils/money'


// Explains the most likely failure: the database script hasn't been run yet.
export function creditErrorMessage(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`

  if (/set_customer_credit|customer_credit_changes|has_credit/i.test(text)) {
    return 'Credit for each customer is not set up in the database yet — run db/migrations/047_customer_credit.sql in Supabase.'
  }

  if (/PGRST20[25]|42P01|42883|does not exist|could not find/i.test(text)) {
    return 'Credit limits are not set up in the database yet — run db/migrations/002_credit_limit.sql in Supabase.'
  }

  return error?.message || 'Could not load the credit limit.'
}
