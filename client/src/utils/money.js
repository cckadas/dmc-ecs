// Money in the system (db/migrations/048): customers are charged in US dollars,
// suppliers are paid in pesos. US$ rather than a bare $, since many customers
// use dollars of their own (Hong Kong, Taiwan, Australia, New Zealand, Canada).
export const formatUsd = (value, decimals = 2) =>
  `US$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`

export const formatPhp = (value) =>
  `₱${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// The exchange rate as staff read it: "US$1 = ₱63.7770".
export const rateText = (phpPerUsd) =>
  `US$1 = ₱${Number(phpPerUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`

// A rate's day, e.g. "Nov 20, 2026".
export const rateDay = (date) => (date
  ? new Date(`${String(date).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  : '')
