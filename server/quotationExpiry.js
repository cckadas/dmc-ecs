import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// Quotation expiry
//
// A quotation can be approved through its expiry date (7 days, Sundays not
// counted). The customer is reminded 2 days before. The day after, the
// quotation and its request are marked expired and the customer and sales are
// told; the customer can then ask for a new quote from Quotation Requests.
//
// The database does the work, in one step (apply_quotation_expiry in
// db/migrations/035); the server only calls it every 5 minutes, as it does the
// down payment deadlines (paymentDeadlines.js). Each reminder and expiry happens
// once, however many servers call it. An expired quotation can't be approved
// even before the next call: the database refuses it.
// =============================================================================

const CHECK_EVERY = 5 * 60 * 1000
const FIRST_CHECK_AFTER = 75 * 1000          // just after the down payment check

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || /apply_quotation_expiry/.test(error?.message || '')

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`


// One run: the quotations reminded and expired. dryRun says what would happen
// without changing anything.
export async function applyQuotationExpiry({ client = supabaseAdmin, dryRun = false } = {}) {
  const { data, error } = await client.rpc('apply_quotation_expiry', { p_today: null, p_dry_run: dryRun })
  if (error) throw error

  return {
    reminders: data?.reminders || [],
    expired: data?.expired || [],
  }
}


let waitingNoted = false

// Starts the run, every 5 minutes (one at a time: a run still going is left to finish).
export function startQuotationExpiry() {
  let running = false

  const run = async () => {
    if (running) return
    running = true

    try {
      const { reminders, expired } = await applyQuotationExpiry()
      const done = [
        reminders.length && `${plural(reminders.length, 'reminder')} sent`,
        expired.length && `expired ${expired.join(', ')}`,
      ].filter(Boolean)
      if (done.length) console.log(`Quotation expiry: ${done.join('; ')}.`)
      waitingNoted = false
    } catch (error) {
      if (isMissingFunction(error)) {
        if (!waitingNoted) console.warn('Quotation expiry is waiting for db/migrations/035_expired_quotations.sql to be run in Supabase.')
        waitingNoted = true
      } else {
        console.error('Quotation expiry check failed:', error?.message || error)
      }
    } finally {
      running = false
    }
  }

  setTimeout(run, FIRST_CHECK_AFTER).unref()
  setInterval(run, CHECK_EVERY).unref()
}
