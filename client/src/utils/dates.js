// Business-rule lead times, in days. Kept here so each rule has one place to
// change once the team confirms it.
export const MIN_PREFERRED_SHIP_DAYS = 14
export const MIN_PO_DELIVERY_DAYS = 14


// Today (plus an offset) as YYYY-MM-DD in the user's local time zone — the
// format <input type="date"> uses.
//
// Not toISOString(): that returns the UTC date, which in the Philippines
// (UTC+8) is still "yesterday" until 8 a.m., so date minimums built from it
// let users pick a day early.
export function localDateString(daysFromToday = 0) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}
