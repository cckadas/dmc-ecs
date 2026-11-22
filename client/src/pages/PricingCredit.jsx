import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import ExportButton from '../components/ExportButton'
import { exportList, money, number } from '../utils/csvExport'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { faFloppyDisk, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'

import IconButton from '../components/IconButton'
import { getMarkups, getContainerSizes, getContainerFillPercent, pricingErrorMessage } from '../services/pricingService'
import { getCreditLimit, saveCreditLimit, formatUsd, creditErrorMessage } from '../services/creditService'
import { withNewColumns } from '../utils/newColumns'
import TableScroll from '../components/TableScroll'
import ShippingUsdSection from '../components/ShippingUsdSection'
import { COUNTRY_NAMES, countryKey } from '../utils/countryPlaces'


const th = 'px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600'


// =============================================
// MARKUPS & CREDIT
//
// The rules that protect DMC's money: the fixed markups, shipping and container
// costs that set every quotation, and the credit limit that stops a customer
// ordering more once their unpaid balance reaches it. Admin and management only.
// =============================================
export default function PricingCreditPage() {
  // Adding or removing a country's markup shows it in the shipping section too.
  const [shippingVersion, setShippingVersion] = useState(0)

  return (
    <div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Markups & Credit
        </h1>

        <p className="mt-1 text-gray-500">
          The markups, shipping and container costs that set every quotation, in US dollars, and how much a customer can owe before they can't order more.
        </p>
      </div>

      <div className="mb-10">
        <MarkupsSection onChange={() => setShippingVersion((version) => version + 1)} />
      </div>

      <div className="mb-10">
        <ShippingUsdSection version={shippingVersion} />
      </div>

      <div className="mb-10">
        <ContainersSection />
      </div>

      <CreditSection />
    </div>
  )
}



// =============================================
// MARKUPS BY DESTINATION COUNTRY
//
// A quotation's prices are fixed: each line is the supplier's peso price in US
// dollars at today's exchange rate, plus the country's markup. A country
// without its own row uses the Default row. Sales can't change them, so these
// rates are the only lever on what customers pay. Shipping costs, in US
// dollars, have their own section (ShippingUsdSection, db/migrations/048).
// =============================================
function MarkupsSection({ onChange = () => {} }) {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [markups, setMarkups] = useState([])
  const [drafts, setDrafts] = useState({})
  const [newCountry, setNewCountry] = useState('')
  const [newPercent, setNewPercent] = useState('')
  const [loadError, setLoadError] = useState('')


  async function loadMarkups() {
    try {
      const data = await getMarkups()
      setMarkups(data)
      setDrafts(Object.fromEntries(data.map((markup) => [
        markup.country,
        {
          percent: String(markup.markup_percent),
        },
      ])))
      setLoadError('')
    } catch (error) {
      setLoadError(pricingErrorMessage(error))
    }
  }


  function updateDraft(country, field, value) {
    setDrafts({ ...drafts, [country]: { ...drafts[country], [field]: value } })
  }


  async function saveMarkup(country, percentText) {
    const name = country.trim()
    const percent = Number(percentText)

    if (!name) {
      toast.error('Enter a country.')
      return false
    }

    if (percentText === '' || !(percent >= 0)) {
      toast.error('Enter a markup of 0% or more.')
      return false
    }

    const { error } = await supabase
      .from('market_markups')
      .upsert(
        {
          country: name,
          markup_percent: percent,
          updated_by: profile?.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'country' }
      )

    if (error) {
      // The database's own rule: one row per country, however it's spelled (032).
      toast.error(error.code === '23505' ? `${name} already has its rates. Change them in its row instead.` : error.message)
      return false
    }

    toast.success(`Markup for ${name} saved.`)
    await loadMarkups()
    onChange()
    return true
  }


  async function addMarkup() {
    // A country picked from the list, and only one that has no rates yet.
    const existing = markups.find((markup) => countryKey(markup.country) === countryKey(newCountry))
    if (existing) {
      toast.error(`${existing.country} already has its rates. Change them in its row instead.`)
      return
    }

    const name = newCountry
    if (await saveMarkup(newCountry, newPercent)) {
      setNewCountry('')
      setNewPercent('')
      toast.success(`Now set the shipping cost for ${name} in US dollars, in the next section.`)
    }
  }


  async function removeMarkup(country) {
    const confirmed = window.confirm(
      `Remove the rates for ${country}? Quotations to ${country} will use the Default markup and shipping cost instead.`
    )

    if (!confirmed) return

    const { error } = await supabase
      .from('market_markups')
      .delete()
      .eq('country', country)

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`Rates for ${country} removed.`)
    loadMarkups()
    onChange()
  }


  useEffect(() => {
    loadMarkups()
  }, [])


  const input = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#1F3A2C]">
          Markups by country
        </h2>

        <ExportButton count={markups.length} onExport={(how) => exportList(how, 'markups', MARKUP_COLUMNS, markups)} />
      </div>

      <p className="mb-3 text-sm text-gray-500">
        Every quotation price is the supplier's peso price in US dollars at today's exchange rate, plus the markup for the delivery country. Countries that aren't listed use the Default row. Sales can't change quotation prices, so these markups and the shipping and container costs are the only way to change what customers pay.
      </p>

      <p className="mb-3 text-sm text-gray-500">
        <span className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Simulated</span>
        markups are worked out until DMC gives its own, from how far each country is from Manila: Hong Kong's 25% (DMC's own) plus 1 point for every 2,000 km farther than Hong Kong, up to 30%. Saving a country's markup makes it DMC's own.
      </p>

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
              <th className={th}>Markup %</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {markups.map((markup) => {
              const isDefault = markup.country.toLowerCase() === 'default'

              return (
                <tr key={markup.country} className="border-t border-gray-200 text-sm">
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {markup.country}
                    {isDefault && <span className="ml-2 text-xs text-gray-500">(used for unlisted countries)</span>}
                    {markup.is_simulated && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Simulated</span>}
                  </td>

                  <td className="px-5 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={drafts[markup.country]?.percent ?? ''}
                      onChange={(e) => updateDraft(markup.country, 'percent', e.target.value)}
                      className={`${input} w-28 text-right`}
                    />
                  </td>

                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <IconButton icon={faFloppyDisk} title="Save Rates" color="green" onClick={() => saveMarkup(markup.country, drafts[markup.country]?.percent ?? '')} />

                      {!isDefault && (
                        <IconButton icon={faTrash} title="Remove Rates" color="red" onClick={() => removeMarkup(markup.country)} />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}

            <tr className="border-t border-gray-200 bg-gray-50 text-sm">
              <td className="px-5 py-3">
                {/* Picked, not typed, so a country can't be added twice under
                    another spelling ("Hongkong" next to "Hong Kong"). */}
                <select
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                  aria-label="Country to add"
                  className={`${input} w-48`}
                >
                  <option value="">Choose a country</option>
                  {COUNTRY_NAMES
                    .filter((name) => !markups.some((markup) => countryKey(markup.country) === countryKey(name)))
                    .map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                </select>
              </td>

              <td className="px-5 py-3">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newPercent}
                  onChange={(e) => setNewPercent(e.target.value)}
                  placeholder="0"
                  className={`${input} w-28 text-right`}
                />
              </td>

              <td className="px-5 py-3">
                <IconButton icon={faPlus} title="Add Country" color="green" onClick={addMarkup} />
              </td>
            </tr>
          </tbody>
        </table>
      </TableScroll>
    </div>
  )
}



// =============================================
// CONTAINERS
//
// Every quotation also pays the fixed cost of its container: the smallest size
// that holds the order's cases, or a bigger one if the customer wants to
// upgrade. The volumes and weight limits are the global standard sizes; the
// fill percent is how full a container's volume may be packed, since cases
// rarely fill every corner. The database sets each quotation's container cost
// from here (db/migrations/016).
// =============================================
function ContainersSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [sizes, setSizes] = useState([])
  const [drafts, setDrafts] = useState({})
  const [fillPercent, setFillPercent] = useState(null)
  const [fillDraft, setFillDraft] = useState('')
  const [loadError, setLoadError] = useState('')


  async function loadContainers() {
    try {
      const [data, fill] = await Promise.all([getContainerSizes(), getContainerFillPercent()])
      setSizes(data)
      setDrafts(Object.fromEntries(data.map((size) => [
        size.code,
        {
          volume: String(size.inside_cbm),
          weight: String(size.max_weight_kg),
          cost: size.cost == null ? '' : String(size.cost),
        },
      ])))
      setFillPercent(fill)
      setFillDraft(String(fill))
      setLoadError('')
    } catch (error) {
      setLoadError(pricingErrorMessage(error))
    }
  }


  function updateDraft(code, field, value) {
    setDrafts({ ...drafts, [code]: { ...drafts[code], [field]: value } })
  }


  async function saveSize(size) {
    const draft = drafts[size.code] || {}
    const volume = Number(draft.volume)
    const weight = Number(draft.weight)
    const cost = Number(draft.cost)

    if (!(volume > 0)) {
      toast.error(`Enter the ${size.name}'s inside volume.`)
      return
    }

    if (!(weight > 0)) {
      toast.error(`Enter the ${size.name}'s weight limit.`)
      return
    }

    // Required: a missing cost would stop quotations that need this size.
    if (draft.cost === '' || !(cost >= 0)) {
      toast.error(`Enter a cost of US$0 or more for the ${size.name}.`)
      return
    }

    const { error } = await supabase
      .from('container_sizes')
      .update({
        inside_cbm: volume,
        max_weight_kg: weight,
        cost,
        updated_by: profile?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('code', size.code)

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`${size.name} saved.`)
    loadContainers()
  }


  async function saveFillPercent() {
    const value = Number(fillDraft)

    if (fillDraft === '' || !(value > 0 && value <= 100)) {
      toast.error('Enter a fill percent from 1 to 100.')
      return
    }

    const { error } = await supabase
      .from('business_settings')
      .upsert(
        {
          key: 'container_fill_percent',
          value,
          updated_by: profile?.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`Containers will be filled up to ${value}% of their volume.`)
    loadContainers()
  }


  useEffect(() => {
    loadContainers()
  }, [])


  const input = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]'

  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Container costs
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        Each quotation also pays the fixed cost of its container: the smallest size that holds the order's cases by volume and weight, or a bigger one if the customer wants to upgrade. The sizes are the global standard ones, so change them only if DMC's differ.
      </p>

      {loadError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{loadError}</p>
        </div>
      )}

      <TableScroll className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Container</th>
              <th className={th}>Inside Volume (m³)</th>
              <th className={th}>Weight Limit (kg)</th>
              <th className={th}>Cost (US$)</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {sizes.map((size) => (
              <tr key={size.code} className="border-t border-gray-200 text-sm">
                <td className="px-5 py-3 font-medium text-gray-800">
                  {size.name}
                </td>

                <td className="px-5 py-3">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={drafts[size.code]?.volume ?? ''}
                    onChange={(e) => updateDraft(size.code, 'volume', e.target.value)}
                    className={`${input} w-28 text-right`}
                  />
                </td>

                <td className="px-5 py-3">
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={drafts[size.code]?.weight ?? ''}
                    onChange={(e) => updateDraft(size.code, 'weight', e.target.value)}
                    className={`${input} w-32 text-right`}
                  />
                </td>

                <td className="px-5 py-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={drafts[size.code]?.cost ?? ''}
                    onChange={(e) => updateDraft(size.code, 'cost', e.target.value)}
                    placeholder="Not set"
                    className={`${input} w-36 text-right`}
                  />
                </td>

                <td className="px-5 py-3">
                  <IconButton icon={faFloppyDisk} title="Save Container" color="green" onClick={() => saveSize(size)} />
                </td>
              </tr>
            ))}

            {sizes.length === 0 && !loadError && (
              <tr>
                <td colSpan="5" className="px-5 py-8 text-center text-sm text-gray-500">
                  No container sizes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <span className="text-sm font-medium text-gray-700">
          Fill containers up to
        </span>

        <div className="relative">
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={fillDraft}
            onChange={(e) => setFillDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveFillPercent() }}
            className={`${input} w-24 pr-7 text-right`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
        </div>

        <span className="text-sm text-gray-500">
          of their volume. Cases rarely fill every corner.
        </span>

        <button
          type="button"
          onClick={saveFillPercent}
          className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633]"
        >
          Save
        </button>

        <span className="text-sm text-gray-500">
          Current: {fillPercent == null ? '-' : `${fillPercent}%`}
        </span>
      </div>
    </div>
  )
}



// =============================================
// CREDIT LIMIT
//
// A customer's unpaid balance is what they still owe on all their orders.
// Credit is given customer by customer, on the Customers page (047): with it,
// once the balance reaches their limit they can't send new quotation requests
// or approve quotations until they pay; without it, they have one unpaid
// order at a time. The standard limit here is what admin starts from when
// giving credit. The database enforces it all (002, 040, 047).
// =============================================
function CreditSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [creditLimit, setCreditLimit] = useState(null)
  const [draft, setDraft] = useState('')
  const [balances, setBalances] = useState([])
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)


  async function loadCredit() {
    try {
      const limit = await getCreditLimit()

      const [customersResult, ordersResult] = await Promise.all([
        // Each customer's own credit (047), asked again without it until that's run.
        withNewColumns((withCredit) => supabase.from('profiles').select(`id, name, company${withCredit ? ', has_credit, credit_limit' : ''}`).eq('role', 'customer'), ['has_credit', 'credit_limit']),
        supabase.from('customer_orders').select('customer_id, total_amount, settled_amount, status'),
      ])

      if (customersResult.error) throw customersResult.error
      if (ordersResult.error) throw ordersResult.error

      // The same sum the database uses: what is still owed on every order,
      // cancelled ones aside (db/migrations/028).
      const owed = {}

      for (const order of ordersResult.data || []) {
        if (String(order.status || '').trim().toLowerCase() === 'cancelled') continue
        const unpaid = Math.max(Number(order.total_amount || 0) - Number(order.settled_amount || 0), 0)
        owed[order.customer_id] = (owed[order.customer_id] || 0) + unpaid
      }

      setCreditLimit(limit)
      setDraft(limit == null ? '' : String(limit))
      setBalances(
        (customersResult.data || [])
          .map((customer) => ({ ...customer, outstanding: owed[customer.id] || 0 }))
          .sort((a, b) => b.outstanding - a.outstanding)
      )
      setLoadError('')
    } catch (error) {
      setLoadError(creditErrorMessage(error))
    }
  }


  async function saveLimit() {
    const value = Number(draft)

    if (draft === '' || !(value > 0)) {
      toast.error('Enter a credit limit above US$0.')
      return
    }

    setSaving(true)

    try {
      await saveCreditLimit(value, profile?.id)
      toast.success(`Standard credit limit set to ${formatUsd(value)}.`)
      await loadCredit()
    } catch (error) {
      toast.error(creditErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }


  useEffect(() => {
    loadCredit()
  }, [])


  // Whether customers have their own credit yet (047 run).
  const perCustomer = balances.some((customer) => customer.has_credit !== undefined)


  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#1F3A2C]">
          Credit
        </h2>

        <ExportButton count={balances.length} onExport={(how) => exportList(how, 'customer-balances', balanceColumns(creditLimit), balances)} />
      </div>

      <p className="mb-3 text-sm text-gray-500">
        {perCustomer
          ? "DMC gives credit customer by customer: admin gives it, changes its limit or removes it on the Customers page. With credit, once a customer's unpaid balance reaches their limit, they can't send new quotation requests or approve quotations until they pay. Without credit (every new customer), a customer has one unpaid order at a time, and each order ships only once it's paid in full. Every unpaid order counts, including overdue ones."
          : "Once a customer's unpaid balance reaches this amount, they can't send new quotation requests or approve quotations until they pay. Every unpaid order counts, including overdue ones."}
      </p>

      {loadError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{loadError}</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {perCustomer && <span className="text-sm font-medium text-gray-700">Standard limit</span>}

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">US$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveLimit() }}
            disabled={saving}
            placeholder="0.00"
            className="w-48 rounded-md border border-gray-300 bg-white py-2 pl-11 pr-3 text-right text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
          />
        </div>

        <button
          type="button"
          onClick={saveLimit}
          disabled={saving}
          className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Limit'}
        </button>

        <span className="text-sm text-gray-500">
          Current {perCustomer ? 'standard ' : ''}limit: {creditLimit == null ? 'none' : formatUsd(creditLimit)}
          {perCustomer ? ". It's what admin starts from when giving a customer credit; changing it changes nobody's limit." : ''}
        </span>
      </div>

      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Customer</th>
              <th className={th}>Company</th>
              <th className={th}>Unpaid Balance</th>
              <th className={th}>Credit Limit</th>
              <th className={th}>Status</th>
            </tr>
          </thead>

          <tbody>
            {balances.length > 0 ? (
              balances.map((customer) => {
                const state = creditStanding(customer, creditLimit)

                return (
                  <tr key={customer.id} className="border-t border-gray-200 text-sm">
                    <td className="px-5 py-3 font-medium text-gray-800">{customer.name || '-'}</td>
                    <td className="px-5 py-3">{customer.company || '-'}</td>
                    <td className="px-5 py-3">{formatUsd(customer.outstanding)}</td>
                    <td className="px-5 py-3">{limitText(customer, creditLimit)}</td>
                    <td className={`px-5 py-3 ${state.className}`}>{state.label}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan="5" className="px-5 py-8 text-center text-sm text-gray-500">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// The markups by country, and each customer's unpaid balance against the credit limit.
// =============================================
const MARKUP_COLUMNS = [
  { header: 'Country', value: (markup) => markup.country },
  { header: 'Markup (%)', value: (markup) => number(markup.markup_percent) },
  { header: 'Simulated', value: (markup) => Boolean(markup.is_simulated) },
]

// Where a customer stands: their own limit, or no credit (047); before that's
// run, DMC's one limit for everyone.
function creditStanding(customer, standard) {
  if (customer.has_credit === false) {
    return customer.outstanding > 0.009
      ? { label: 'No credit: pays before the next order', className: 'font-medium text-amber-700' }
      : { label: 'No credit: can order', className: 'text-gray-600' }
  }

  const limit = customer.has_credit ? Number(customer.credit_limit) : standard
  if (limit == null) return { label: 'No limit set', className: 'text-gray-500' }
  if (customer.outstanding >= limit) return { label: 'Blocked — must pay first', className: 'font-medium text-red-700' }
  if (customer.outstanding >= limit * 0.8) return { label: 'Near the limit', className: 'font-medium text-amber-700' }
  return { label: 'Can order', className: 'text-green-700' }
}

function limitText(customer, standard) {
  if (customer.has_credit === false) return 'No credit'
  const limit = customer.has_credit ? customer.credit_limit : standard
  return limit == null ? 'None' : formatUsd(limit)
}

const balanceColumns = (standard) => [
  { header: 'Customer', value: (customer) => customer.name },
  { header: 'Company', value: (customer) => customer.company },
  { header: 'Unpaid balance (USD)', value: (customer) => money(customer.outstanding) },
  { header: 'Credit limit (USD)', value: (customer) => (customer.has_credit === false ? 'No credit' : money(customer.has_credit ? customer.credit_limit : standard)) },
  { header: 'Standing', value: (customer) => creditStanding(customer, standard).label },
]
