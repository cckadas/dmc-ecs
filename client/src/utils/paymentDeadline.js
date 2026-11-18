// =============================================================================
// The down payment's deadline (DMC's rule, db/migrations/028)
//
// The down payment is due 7 days after the quotation expires. The customer is
// reminded 2 days before and on the day. It can still be paid for 7 more days;
// the day after that, the order is cancelled. The database does the reminding
// and the cancelling, and refuses a payment sent too late; this only works out
// the same dates for the screens and the order assistant.
//
// Pure: no imports, so the server can use it too.
// =============================================================================

export const DAYS_TO_PAY = 7           // after the quotation expires
export const DAYS_AFTER_DEADLINE = 7   // it can still be paid this long after the deadline
export const REMINDER_DAYS_BEFORE = 2

const normalize = (status) => String(status || '').trim().toLowerCase()

const addDays = (day, days) => {
  const date = new Date(`${String(day).slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Today in the Philippines, as YYYY-MM-DD (the database counts days the same way).
export const manilaToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

// A YYYY-MM-DD day for display, e.g. "Nov 25, 2026".
export const formatDay = (day, locale = undefined) =>
  day ? new Date(`${String(day).slice(0, 10)}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// The deadline, the last day it can still be paid, and the day the order is
// cancelled if it hasn't been, as YYYY-MM-DD. Null without an expiry date.
export function downPaymentDates(order) {
  if (!order?.expiry_date) return null
  const deadline = addDays(order.expiry_date, DAYS_TO_PAY)
  const lastDay = addDays(deadline, DAYS_AFTER_DEADLINE)
  return { deadline, lastDay, cancelOn: addDays(lastDay, 1) }
}

// Where an order stands with its down payment, and the dates:
//   cancelled    the order was cancelled
//   paid         the down payment was verified (the balance has no deadline)
//   checking     a payment was sent and waits for DMC to check it
//   due          not paid yet; the deadline is more than 2 days away
//   due soon     within 2 days of the deadline
//   due today    today is the deadline
//   overdue      past the deadline, still payable until the last day
//   closed       past the last day: it can't be paid, and is being cancelled
export function downPaymentStatus(order, today = manilaToday()) {
  const dates = downPaymentDates(order)
  const status = normalize(order?.status)

  if (status === 'cancelled') return { state: 'cancelled', ...dates }
  if (Number(order?.settled_amount || 0) > 0) return { state: 'paid', ...dates }
  if (Number(order?.pending_payment_amount || 0) > 0 || status === 'submitted') return { state: 'checking', ...dates }
  if (!dates) return { state: 'due' }

  if (today > dates.lastDay) return { state: 'closed', ...dates }
  if (today > dates.deadline) return { state: 'overdue', ...dates }
  if (today === dates.deadline) return { state: 'due today', ...dates }
  if (today >= addDays(dates.deadline, -REMINDER_DAYS_BEFORE)) return { state: 'due soon', ...dates }
  return { state: 'due', ...dates }
}

// Still waiting for its down payment, and it can still be paid.
export const canPayDownPayment = (order, today = manilaToday()) =>
  ['due', 'due soon', 'due today', 'overdue'].includes(downPaymentStatus(order, today).state)
