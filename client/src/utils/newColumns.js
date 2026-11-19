// =============================================================================
// Asking for columns a newer database script adds
//
// A page that reads such a column would fail to load in the minutes between
// the website being updated and the script being run in Supabase. Instead, the
// query is asked again without them, and the page works as it did before.
// Pure: the server uses it too.
// =============================================================================

// When an order was cancelled and why (db/migrations/028).
export const CANCELLATION_COLUMNS = ['cancelled_at', 'cancellation_reason']

// The query's error says one of these columns doesn't exist (yet).
export const isMissingColumn = (error, names) =>
  error?.code === '42703' && names.some((name) => String(error.message || '').includes(name))

// run(true) asks for the columns, run(false) leaves them out.
export async function withNewColumns(run, names) {
  const first = await run(true)
  return isMissingColumn(first?.error, names) ? run(false) : first
}

// The same, for a loader that throws its error (estimateLoader's allRows).
export async function withNewColumnsThrown(run, names) {
  try {
    return await run(true)
  } catch (error) {
    if (isMissingColumn(error, names)) return run(false)
    throw error
  }
}

// The columns for a select list, or nothing.
export const columnsIf = (wanted, names) => (wanted ? `${names.join(', ')},` : '')

// Rush shipments (db/migrations/034): an order line's cases in this order's
// container (empty = all of it), and the earlier order's line it carries.
export const RUSH_ITEM_COLUMNS = ['ship_quantity', 'carried_from_item_id']

// A line carried from an earlier order: its cases were ordered, paid and are
// counted there.
export const isCarriedLine = (item) => Boolean(item?.carried_from_item_id)
