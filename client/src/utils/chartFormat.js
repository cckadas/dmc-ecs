// =============================================================================
// Chart colors and number formats, for components/AnalyticsCharts.jsx and the
// pages around the charts.
//
// The colors were checked for color-blind readers against the white cards
// (light mode only: the app has no dark mode). The brand green is kept for the
// page itself; it's too dark and grayish to tell data apart, and next to red it
// can't be told apart by red-green color-blind readers.
// =============================================================================

export const CHART = {
  series: '#2a78d6',    // the data
  muted: '#c3c2b7',     // bars that aren't the point (always labelled)
  critical: '#d03b3b',  // below target, always with the words
  late: '#e34948',      // delivery history: late
  early: '#2a78d6',     // delivery history: early
  onDay: '#898781',     // delivery history: on the promised day
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  ink: '#1f2937',
  inkSecondary: '#6b7280',
  surface: '#ffffff',
  hover: 'rgba(42, 120, 214, 0.06)',
}


// "4.5 days", "14 days": one decimal under 10 days.
export function formatDays(days) {
  if (days === null || days === undefined || Number.isNaN(Number(days))) return '—'
  const rounded = days >= 10 ? Math.round(days) : Math.round(days * 10) / 10
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}

export const formatPercent = (share) => (share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`)

const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortMonthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

// A YYYY-MM-DD date as "Nov 4".
export const formatDay = (day) => (day ? dayFormat.format(new Date(`${String(day).slice(0, 10)}T00:00:00Z`)) : '—')

// A YYYY-MM month as "Nov 2026", or "Nov".
export const formatMonth = (month) => monthFormat.format(new Date(`${month}-01T00:00:00Z`))
export const shortMonth = (month) => shortMonthFormat.format(new Date(`${month}-01T00:00:00Z`))

export const shorten = (name, length = 24) => (name && name.length > length ? `${name.slice(0, length - 1)}…` : name)

// "1 order", "3 orders"; count(2, 'delivery', 'deliveries').
export const count = (number, one, many = `${one}s`) => `${Number(number).toLocaleString('en-US')} ${number === 1 ? one : many}`
