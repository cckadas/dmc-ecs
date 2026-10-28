// Business-rule lead times, in days. Kept here so each rule has one place to
// change once the team confirms it.
export const MIN_PREFERRED_SHIP_DAYS = 14
export const MIN_PO_DELIVERY_DAYS = 14

// DMC: a quotation is valid for exactly 7 days from the day it's generated,
// not counting Sundays. The database sets the same date (db/migrations/009).
export const QUOTATION_VALIDITY_DAYS = 7


// A date as YYYY-MM-DD in the user's local time zone — the format
// <input type="date"> uses.
//
// Not toISOString(): that returns the UTC date, which in the Philippines
// (UTC+8) is still "yesterday" until 8 a.m., so date limits built from it
// would be a day off.
function toLocalDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}


// Today (plus an offset), as YYYY-MM-DD.
export function localDateString(daysFromToday = 0) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)

  return toLocalDateString(date)
}


// Today plus a number of days, skipping Sundays, as YYYY-MM-DD.
// e.g. from Monday, 7 days not counting Sunday lands on the next Tuesday.
export function localDateExcludingSundays(days) {
  const date = new Date()
  let counted = 0

  while (counted < days) {
    date.setDate(date.getDate() + 1)
    if (date.getDay() !== 0) counted++
  }

  return toLocalDateString(date)
}


// A YYYY-MM-DD date for display, e.g. "Tue, Nov 3, 2026".
export const formatDateString = (dateString) =>
  new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
