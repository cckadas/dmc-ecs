import { useEffect, useState } from 'react'
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import ExportButton from './ExportButton'
import IconButton from './IconButton'
import TableScroll from './TableScroll'
import { exportList, money } from '../utils/csvExport'
import { formatUsd, rateDay, rateText } from '../utils/money'
import { getExchangeRate, pricingErrorMessage } from '../services/pricingService'


const th = 'px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600'


// =============================================
// SHIPPING COSTS (db/migrations/048, 050)
//
// DMC's shipping cost to each country, per container, in pesos. Customers pay
// in US dollars: each quotation converts it at the exchange rate it's priced
// at, like the product prices. Until DMC gives its own, the costs are
// simulated (by distance from Manila); saving one makes it DMC's own. The
// exchange rate itself is fetched by the system, never typed.
// =============================================
export default function ShippingUsdSection({ version = 0 }) {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})
  const [rate, setRate] = useState(null)
  const [loadError, setLoadError] = useState('')


  async function load() {
    try {
      const [{ data, error }, current] = await Promise.all([
        supabase
          .from('market_markups')
          .select('country, shipping_cost, shipping_converted_rate, is_simulated')
          .order('country'),
        getExchangeRate(),
      ])

      if (error) throw error

      setRows(data || [])
      setDrafts(Object.fromEntries((data || []).map((row) => [
        row.country,
        row.shipping_cost == null ? '' : String(row.shipping_cost),
      ])))
      setRate(current)
      setLoadError('')
    } catch (error) {
      setLoadError(pricingErrorMessage(error))
    }
  }


  async function save(country) {
    const text = drafts[country] ?? ''
    const value = Number(text)

    // Required: a missing cost would stop quotations to this country.
    if (text === '' || !(value >= 0)) {
      toast.error('Enter a shipping cost of ₱0 or more.')
      return
    }

    const { error } = await supabase
      .from('market_markups')
      .update({
        shipping_cost: value,
        shipping_converted_rate: null,
        shipping_converted_on: null,
        updated_by: profile?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('country', country)

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`Shipping to ${country} saved: ₱${value.toLocaleString('en-US', { minimumFractionDigits: 2 })} per container.`)
    load()
  }


  useEffect(() => {
    load()
  }, [version])


  const input = 'rounded-md border border-gray-300 bg-white py-2 pl-7 pr-3 text-right text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#1F3A2C]">
          Shipping costs
        </h2>

        <ExportButton count={rows.length} onExport={(how) => exportList(how, 'shipping-costs', SHIPPING_COLUMNS(rate), rows)} />
      </div>

      <p className="mb-3 text-sm text-gray-500">
        DMC's shipping cost to each country, per container, in pesos. Customers pay in US dollars: each quotation converts it at the exchange rate it's priced at, like the product prices, and pays it for every container it needs. Countries that aren't listed use the Default row.
        {' '}<span className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Simulated</span>
        costs are worked out by distance from Manila until DMC gives its own. Saving a country's cost makes it DMC's own.
      </p>

      <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        {rate
          ? <>Today's exchange rate: <span className="font-medium">{rateText(rate.phpPerUsd)}</span> (European Central Bank, {rateDay(rate.rateDate)}). The system fetches it by itself; DMC's staff are told when it changes.</>
          : 'No exchange rate yet. The system fetches it from the European Central Bank by itself.'}
      </div>

      {loadError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{loadError}</p>
        </div>
      )}

      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Country</th>
              <th className={th}>Shipping per container</th>
              <th className={th}>In US dollars today</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const simulated = row.shipping_converted_rate != null
              const draft = drafts[row.country] ?? ''

              return (
                <tr key={row.country} className="border-t border-gray-200 text-sm">
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {row.country}
                    {row.country.toLowerCase() === 'default' && <span className="ml-2 text-xs text-gray-500">(used for unlisted countries)</span>}
                    {simulated && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Simulated</span>}
                  </td>

                  <td className="px-5 py-3">
                    <div className="relative w-44">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₱</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft}
                        onChange={(e) => setDrafts({ ...drafts, [row.country]: e.target.value })}
                        placeholder="Not set"
                        className={`${input} w-44`}
                      />
                    </div>
                    {row.shipping_cost == null && (
                      <p className="mt-1 text-xs font-medium text-amber-700">Not set: quotations to {row.country} can't be priced until it is.</p>
                    )}
                  </td>

                  <td className="px-5 py-3 text-gray-600">
                    {rate && draft !== '' ? formatUsd(Number(draft) / rate.phpPerUsd) : '-'}
                  </td>

                  <td className="px-5 py-3">
                    <IconButton icon={faFloppyDisk} title="Save Shipping Cost" color="green" onClick={() => save(row.country)} />
                  </td>
                </tr>
              )
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan="4" className="px-5 py-8 text-center text-sm text-gray-500">
                  No countries yet: add one under Markups by country.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
    </div>
  )
}


// The export (utils/csvExport.js).
const SHIPPING_COLUMNS = (rate) => [
  { header: 'Country', value: (row) => row.country },
  { header: 'Shipping per container (PHP)', value: (row) => money(row.shipping_cost) },
  { header: 'In US dollars today (USD)', value: (row) => (rate && row.shipping_cost != null ? money(Number(row.shipping_cost) / rate.phpPerUsd) : '') },
  { header: 'Simulated', value: (row) => row.shipping_converted_rate != null },
]
