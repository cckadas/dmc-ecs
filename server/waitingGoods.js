import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// A rush shipment's waiting goods: 6 months, then DMC's
//
// Goods a rush shipment left waiting (034) go with the customer's next order,
// with other products or on their own. The customer has 6 months, from when
// the goods are all in DMC's warehouse and the rushed order's container has
// left; they and sales are reminded a month and a week before. After that the
// goods are DMC's: their racks are freed and the warehouse is told to clear
// them.
//
// The database does the work, in one step (apply_waiting_goods_deadlines in
// db/migrations/039); the server only calls it every 5 minutes, as it does the
// down payment deadlines and quotation expiry. Each reminder happens once,
// however many servers call it.
// =============================================================================

const CHECK_EVERY = 5 * 60 * 1000
const FIRST_CHECK_AFTER = 90 * 1000          // just after the quotation expiry check

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || /apply_waiting_goods_deadlines/.test(error?.message || '')

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`


// One run: the reminders sent and the orders whose goods became DMC's. dryRun
// says what would happen without changing anything.
export async function applyWaitingGoodsDeadlines({ client = supabaseAdmin, dryRun = false } = {}) {
  const { data, error } = await client.rpc('apply_waiting_goods_deadlines', { p_today: null, p_dry_run: dryRun })
  if (error) throw error

  return {
    reminders: data?.reminders || [],
    given: data?.given || [],
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
      const { reminders, given } = await applyWaitingGoodsDeadlines()
      const done = [
        reminders.length && `${plural(reminders.length, 'reminder')} sent`,
        given.length && `waiting goods now DMC's: ${given.join(', ')}`,
      ].filter(Boolean)
      if (done.length) console.log(`Waiting goods: ${done.join('; ')}.`)
      waitingNoted = false
    } catch (error) {
      if (isMissingFunction(error)) {
        if (!waitingNoted) console.warn('Waiting goods check is waiting for db/migrations/039_waiting_goods_six_months.sql to be run in Supabase.')
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
