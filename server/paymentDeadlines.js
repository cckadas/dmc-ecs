import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// Down payment deadlines
//
// DMC's rule: the down payment is due 7 days after the quotation expires. The
// customer is reminded 2 days before and on the day (sales is told on the day
// too). It can still be paid for 7 more days; if it hasn't come by then, the
// order is cancelled. The order, its quotation and its request are kept, marked
// cancelled, and the customer, sales and management are told.
//
// The database does the work, in one step (apply_payment_deadlines in
// db/migrations/028); the server only calls it every 5 minutes. Each reminder
// and cancellation happens once, however many servers call it. A customer
// can't pay after the 7 days even before the next call: the database refuses it.
// =============================================================================

const CHECK_EVERY = 5 * 60 * 1000
const FIRST_CHECK_AFTER = 60 * 1000          // a minute after the server starts

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || /apply_payment_deadlines/.test(error?.message || '')

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`


// One run: what was sent and cancelled. dryRun says what would happen without
// changing anything.
export async function applyPaymentDeadlines({ client = supabaseAdmin, dryRun = false } = {}) {
  const { data, error } = await client.rpc('apply_payment_deadlines', { p_today: null, p_dry_run: dryRun })
  if (error) throw error

  return {
    reminders: data?.reminders || [],
    deadlineNotices: data?.deadline_notices || [],
    cancelled: data?.cancelled || [],
  }
}


let waitingNoted = false

// Starts the run, every 5 minutes (one at a time: a run still going is left to finish).
export function startPaymentDeadlines() {
  let running = false

  const run = async () => {
    if (running) return
    running = true

    try {
      const { reminders, deadlineNotices, cancelled } = await applyPaymentDeadlines()
      const done = [
        reminders.length && `${plural(reminders.length, 'reminder')} sent`,
        deadlineNotices.length && `${plural(deadlineNotices.length, 'deadline notice')} sent`,
        cancelled.length && `cancelled ${cancelled.join(', ')}`,
      ].filter(Boolean)
      if (done.length) console.log(`Down payment deadlines: ${done.join('; ')}.`)
      waitingNoted = false
    } catch (error) {
      if (isMissingFunction(error)) {
        if (!waitingNoted) console.warn('Down payment deadlines are waiting for db/migrations/028_cancel_unpaid_orders.sql to be run in Supabase.')
        waitingNoted = true
      } else {
        console.error('Down payment deadlines check failed:', error?.message || error)
      }
    } finally {
      running = false
    }
  }

  setTimeout(run, FIRST_CHECK_AFTER).unref()
  setInterval(run, CHECK_EVERY).unref()
}
