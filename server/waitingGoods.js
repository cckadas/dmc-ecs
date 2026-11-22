import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// A rush shipment's waiting goods: 2 weeks, then DMC's
//
// Goods a rush shipment left waiting (034) go with the customer's next order,
// with other products or on their own. That order must be approved within 2
// weeks of when the goods are all in DMC's warehouse and the rushed order's
// container has left; the customer and sales are told when the 2 weeks start,
// a week before and 2 days before the last day. The day after it, the goods
// are DMC's: their racks are freed, the warehouse is told to clear them, and a
// quotation still waiting with them is withdrawn so DMC prices that request
// again without them.
//
// The database does the work, in one step (apply_waiting_goods_deadlines in
// db/migrations/041); the server only calls it every 5 minutes, as it does the
// down payment deadlines and quotation expiry. Each reminder happens once,
// however many servers call it.
// =============================================================================

const CHECK_EVERY = 5 * 60 * 1000
const FIRST_CHECK_AFTER = 90 * 1000          // just after the quotation expiry check

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || /apply_waiting_goods_deadlines/.test(error?.message || '')

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`


// One run: the reminders sent, the orders whose goods became DMC's, and the
// quotations withdrawn and requests cancelled because of it (041). dryRun says
// what would happen without changing anything.
export async function applyWaitingGoodsDeadlines({ client = supabaseAdmin, dryRun = false } = {}) {
  const { data, error } = await client.rpc('apply_waiting_goods_deadlines', { p_today: null, p_dry_run: dryRun })
  if (error) throw error

  return {
    reminders: data?.reminders || [],
    given: data?.given || [],
    requestsChanged: data?.requests_changed || [],
  }
}


let waitingNoted = false

// Starts the run, every 5 minutes (one at a time: a run still going is left to finish).
export function startWaitingGoodsDeadlines() {
  let running = false

  const run = async () => {
    if (running) return
    running = true

    try {
      const { reminders, given, requestsChanged } = await applyWaitingGoodsDeadlines()
      const withdrawn = requestsChanged.map((entry) => entry.withdrawn).filter(Boolean)
      const cancelled = requestsChanged.map((entry) => entry.cancelled).filter(Boolean)
      const done = [
        reminders.length && `${plural(reminders.length, 'reminder')} sent`,
        given.length && `waiting goods now DMC's: ${given.join(', ')}`,
        withdrawn.length && `quotations withdrawn: ${withdrawn.join(', ')}`,
        cancelled.length && `requests cancelled: ${cancelled.join(', ')}`,
      ].filter(Boolean)
      if (done.length) console.log(`Waiting goods: ${done.join('; ')}.`)
      waitingNoted = false
    } catch (error) {
      if (isMissingFunction(error)) {
        if (!waitingNoted) console.warn('Waiting goods check is waiting for db/migrations/039_waiting_goods_six_months.sql (then 041) to be run in Supabase.')
        waitingNoted = true
      } else {
        console.error('Waiting goods check failed:', error?.message || error)
      }
    } finally {
      running = false
    }
  }

  setTimeout(run, FIRST_CHECK_AFTER).unref()
  setInterval(run, CHECK_EVERY).unref()
}
