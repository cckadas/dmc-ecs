// =============================================================================
// Showing, sorting and searching a page's list of records
//
// Every record list (orders, payments, billings, purchase orders, labels...)
// gets the same three controls: Show (one status, or a group such as "Payments
// to check", each with how many records it has), Sort by, and Search (the
// record's number, and the customer where staff see one). Each page says what
// its statuses are and in what order. Pure: no imports.
// =============================================================================

export const ALL = 'all'

export const normalizeStatus = (status) => String(status || '').trim().toLowerCase()

// As the status badges write it, e.g. "Payment Rejected".
export const statusLabel = (status) =>
  normalizeStatus(status).split(' ').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Unknown'

const rankIn = (order, status) => {
  const index = order.indexOf(status)
  return index === -1 ? order.length : index
}

// The choices for Show: all, then the page's groups (each with its own test),
// then every status there is, in the page's order, each with its count.
// includeStatuses: false shows only the groups (e.g. a payment's state, not the order's).
export function showChoices(items, { statusOf, order = [], labelOf = statusLabel, groups = [], allLabel = 'All', includeStatuses = true }) {
  const list = items || []
  const counts = {}
  for (const item of list) {
    if (!includeStatuses) break
    const status = normalizeStatus(statusOf(item))
    counts[status] = (counts[status] || 0) + 1
  }

  const statuses = Object.keys(counts).sort((a, b) => rankIn(order, a) - rankIn(order, b) || a.localeCompare(b))

  return [
    { value: ALL, label: allLabel, count: list.length },
    ...groups.map((group) => ({ value: group.value, label: group.label, count: list.filter(group.test).length })),
    ...(includeStatuses ? statuses.map((status) => ({ value: status, label: labelOf(status), count: counts[status] })) : []),
  ]
}

// The records the chosen Show keeps.
export function applyShow(items, show, { statusOf, groups = [] }) {
  const list = items || []
  if (!show || show === ALL) return [...list]
  const group = groups.find((entry) => entry.value === show)
  if (group) return list.filter(group.test)
  return list.filter((item) => normalizeStatus(statusOf(item)) === show)
}

// A Show that no longer has a choice (e.g. its last record moved on) shows all.
export const showingOf = (choices, show) => (choices.some((choice) => choice.value === show) ? show : ALL)

// sorts: { value: compare(a, b) }. Sorting never changes the list it's given.
export function applySort(items, how, sorts) {
  const compare = sorts[how] || Object.values(sorts)[0]
  return compare ? [...(items || [])].sort(compare) : [...(items || [])]
}

// Every word typed must appear in the record's text (any case, any order).
export function applySearch(items, query, textOf) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...(items || [])]
  return (items || []).filter((item) => {
    const text = String(textOf(item) || '').toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

// Ready-made comparisons.
const time = (value) => {
  const ms = Date.parse(value || '')
  return Number.isNaN(ms) ? null : ms
}

// Newest first; records without a date last.
export const byNewest = (dateOf) => (a, b) => (time(dateOf(b)) ?? -Infinity) - (time(dateOf(a)) ?? -Infinity)

// Oldest first; records without a date last.
export const byOldest = (dateOf) => (a, b) => (time(dateOf(a)) ?? Infinity) - (time(dateOf(b)) ?? Infinity)

// The page's status order, then newest first within each status.
export const byStatus = (statusOf, order, dateOf) => (a, b) =>
  rankIn(order, normalizeStatus(statusOf(a))) - rankIn(order, normalizeStatus(statusOf(b))) || byNewest(dateOf)(a, b)

// Soonest first (e.g. an expected delivery date); records without one last.
export const bySoonest = (dateOf) => byOldest(dateOf)

// Highest first (e.g. a balance).
export const byHighest = (numberOf) => (a, b) => Number(numberOf(b) || 0) - Number(numberOf(a) || 0)
