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

// The columns for a select list, or nothing.
export const columnsIf = (wanted, names) => (wanted ? `${names.join(', ')},` : '')
