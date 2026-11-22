import { useEffect, useState } from 'react'
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import ExportButton from './ExportButton'
import IconButton from './IconButton'
import TableScroll from './TableScroll'
import { exportList, money, number } from '../utils/csvExport'
import { formatPhp, formatUsd, rateDay, rateText } from '../utils/money'
import { getExchangeRate, pricingErrorMessage } from '../services/pricingService'


const th = 'px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600'


// =============================================
// SHIPPING COSTS IN US DOLLARS (db/migrations/048)
//
// Customers pay in US dollars, so each country's shipping cost, charged per
// container, is in dollars too. Until DMC gives its own, they are the old
// simulated peso amounts converted at the European Central Bank's rate of the
// day they were converted; each says what it came from. Saving one makes it
// DMC's own. The exchange rate itself is fetched by the system, never typed.
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
          .select('country, shipping_cost_usd, shipping_php_before, shipping_converted_rate, shipping_converted_on, is_simulated')
          .order('country'),
        getExchangeRate(),
      ])

      if (error) throw error

      setRows(data || [])
      setDrafts(Object.fromEntries((data || []).map((row) => [
        row.country,
        row.shipping_cost_usd == null ? '' : String(row.shipping_cost_usd),
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
      toast.error('Enter a shipping cost of US$0 or more.')
      return
    }

    const { error } = await supabase
      .from('market_markups')
      .update({
        shipping_cost_usd: value,
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

    toast.success(`Shipping to ${country} saved: ${formatUsd(value)} per container.`)
    load()
  }


  useEffect(() => {
    load()
  }, [version])


  const input = 'rounded-md border border-gray-300 bg-white py-2 pl-11 pr-3 text-right text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#1F3A2C]">
          Shipping costs in US dollars
        </h2>

        <ExportButton count={rows.length} onExport={(how) => exportList(how, 'shipping-costs-usd', SHIPPING_COLUMNS, rows)} />
      </div>

      <p className="mb-3 text-sm text-gray-500">
        Customers pay in US dollars. Each quotation pays its country's shipping cost for every container it needs. Countries that aren't listed use the Default row.
        {' '}<span className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Simulated</span>
        costs were converted from the old simulated peso amounts until DMC gives its own. Saving a country's cost makes it DMC's own.
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
              <th className={th}>Where it came from</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const converted = row.shipping_converted_rate != null

              return (
                <tr key={row.country} className="border-t border-gray-200 text-sm">
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {row.country}
                    {row.country.toLowerCase() === 'default' && <span className="ml-2 text-xs text-gray-500">(used for unlisted countries)</span>}
                    {converted && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Simulated</span>}
                  </td>

                  <td className="px-5 py-3">
                    <div className="relative w-40">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">US$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={drafts[row.country] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [row.country]: e.target.value })}
                        placeholder="Not set"
                        className={`${input} w-40`}
                      />
                    </div>
                    {row.shipping_cost_usd == null && (
                      <p className="mt-1 text-xs font-medium text-amber-700">Not set: quotations to {row.country} can't be priced until it is.</p>
                    )}
                  </td>

                  <td className="px-5 py-3 text-gray-600">
                    {converted
                      ? `Converted from ${formatPhp(row.shipping_php_before)} at ${rateText(row.shipping_converted_rate)}${row.shipping_converted_on ? ` (${rateDay(row.shipping_converted_on)})` : ''}`
                      : row.shipping_cost_usd == null ? '-' : "DMC's own"}
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
const SHIPPING_COLUMNS = [
  { header: 'Country', value: (row) => row.country },
  { header: 'Shipping per container (USD)', value: (row) => money(row.shipping_cost_usd) },
  { header: 'Converted from (PHP)', value: (row) => (row.shipping_converted_rate != null ? money(row.shipping_php_before) : '') },
  { header: 'At (PHP per USD 1)', value: (row) => (row.shipping_converted_rate != null ? number(row.shipping_converted_rate) : '') },
  { header: 'Simulated', value: (row) => row.shipping_converted_rate != null },
]
