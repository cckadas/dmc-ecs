import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// The exchange rate: pesos per US dollar
//
// DMC pays its suppliers in pesos and charges its customers in US dollars. A
// product's price for a customer is the supplier's peso price divided by the
// day's rate, plus the country's markup. The rate is the European Central
// Bank's, through the free Frankfurter service (no sign-up, no key). The ECB
// publishes once each working day, so the server asks every 3 hours; nobody
// types a rate.
//
// The database keeps each day's rate and tells admin, management and sales when
// it changes (record_exchange_rate in db/migrations/048). Each quotation keeps
// the rate it was priced with. If the service can't be reached, the last rate
// kept is used.
// =============================================================================

const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP'
const SOURCE = 'European Central Bank (via Frankfurter)'
const CHECK_EVERY = 3 * 60 * 60 * 1000
const FIRST_CHECK_AFTER = 30 * 1000         // half a minute after the server starts

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' || /record_exchange_rate/.test(error?.message || '')


// One check: the ECB's latest rate, kept. Returns { rate_date, php_per_usd, changed }.
export async function fetchExchangeRate({ client = supabaseAdmin } = {}) {
  const response = await fetch(RATE_URL, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`the rate service answered ${response.status}`)

  const body = await response.json()
  const rate = Number(body?.rates?.PHP)
  if (!body?.date || !(rate > 0)) throw new Error('the rate service sent no peso rate')

  const { data, error } = await client.rpc('record_exchange_rate', { p_date: body.date, p_rate: rate, p_source: SOURCE })
  if (error) throw error
  return data
}


let waitingNoted = false

// Starts the checks, every 3 hours (one at a time).
export function startExchangeRates() {
  let running = false

  const run = async () => {
    if (running) return
    running = true

    try {
      const result = await fetchExchangeRate()
      if (result?.changed) console.log(`Exchange rate: US$1 = PHP ${result.php_per_usd} (ECB, ${result.rate_date}).`)
      waitingNoted = false
    } catch (error) {
      if (isMissingFunction(error)) {
        if (!waitingNoted) console.log('Exchange rate: waiting for db/migrations/048 to be run in Supabase.')
        waitingNoted = true
      } else {
        // The last rate kept is used until the service answers again.
        console.error('Exchange rate: could not update it:', error.message)
      }
    } finally {
      running = false
    }
  }

  setTimeout(run, FIRST_CHECK_AFTER)
  setInterval(run, CHECK_EVERY)
}
