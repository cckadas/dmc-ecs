import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { faFloppyDisk, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'

import IconButton from '../components/IconButton'
import { getMarkups, pricingErrorMessage } from '../services/pricingService'
import { getCreditLimit, saveCreditLimit, formatPeso, creditErrorMessage } from '../services/creditService'
import TableScroll from '../components/TableScroll'


const th = 'px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600'


// =============================================
// MARKUPS & CREDIT
//
// The two rules that protect DMC's money: the fixed markup that sets every
// quotation price, and the credit limit that stops a customer ordering more
// once their unpaid balance reaches it. Admin and management only.
// =============================================
export default function PricingCreditPage() {
  return (
    <div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Markups & Credit
        </h1>

        <p className="mt-1 text-gray-500">
          The markups that set every quotation price, and how much a customer can owe before they can't order more.
        </p>
      </div>

      <div className="mb-10">
        <MarkupsSection />
      </div>

      <CreditSection />
    </div>
  )
}



// =============================================
// MARKUPS AND SHIPPING RATES BY DESTINATION COUNTRY
//
// A quotation's prices are fixed: each line is the supplier price plus the
// country's markup, and shipping is the country's rate per unit x units
// ordered. A country without its own row uses the Default row. Sales can't
// change them, so these rates are the only lever on what customers pay.
// =============================================
function MarkupsSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [markups, setMarkups] = useState([])
  const [drafts, setDrafts] = useState({})
  const [newCountry, setNewCountry] = useState('')
  const [newPercent, setNewPercent] = useState('')
  const [newShipping, setNewShipping] = useState('')
  const [loadError, setLoadError] = useState('')


  async function loadMarkups() {
    try {
      const data = await getMarkups()
      setMarkups(data)
      setDrafts(Object.fromEntries(data.map((markup) => [
        markup.country,
        {
          percent: String(markup.markup_percent),
          shipping: markup.shipping_per_unit == null ? '' : String(markup.shipping_per_unit),
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


  async function saveMarkup(country, percentText, shippingText) {
    const name = country.trim()
    const percent = Number(percentText)
    const shipping = Number(shippingText)

    if (!name) {
      toast.error('Enter a country.')
      return false
    }

    if (percentText === '' || !(percent >= 0)) {
      toast.error('Enter a markup of 0% or more.')
      return false
    }

    // Required: a missing rate would mean quotations go out with no shipping.
    if (shippingText === '' || !(shipping >= 0)) {
      toast.error('Enter a shipping rate per unit of ₱0 or more.')
      return false
    }

    const { error } = await supabase
      .from('market_markups')
      .upsert(
        {
          country: name,
          markup_percent: percent,
          shipping_per_unit: shipping,
          updated_by: profile?.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'country' }
      )

    if (error) {
      toast.error(error.message)
      return false
    }

    toast.success(`Rates for ${name} saved.`)
    await loadMarkups()
    return true
  }


  async function addMarkup() {
    if (await saveMarkup(newCountry, newPercent, newShipping)) {
      setNewCountry('')
      setNewPercent('')
      setNewShipping('')
    }
  }


  async function removeMarkup(country) {
    const confirmed = window.confirm(
      `Remove the rates for ${country}? Quotations to ${country} will use the Default markup and shipping rate instead.`
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
  }


  useEffect(() => {
    loadMarkups()
  }, [])


  const input = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]'

  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Markups and shipping rates by country
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        Every quotation price is the supplier price plus the markup for the delivery country, and shipping is that country's rate per unit times the units ordered. Countries that aren't listed use the Default row. Sales can't change quotation prices or shipping, so these rates are the only way to change what customers pay.
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
              <th className={th}>Shipping per Unit (₱)</th>
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
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={drafts[markup.country]?.shipping ?? ''}
                      onChange={(e) => updateDraft(markup.country, 'shipping', e.target.value)}
                      placeholder="Not set"
                      className={`${input} w-32 text-right`}
                    />
                  </td>

                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <IconButton icon={faFloppyDisk} title="Save Rates" color="green" onClick={() => saveMarkup(markup.country, drafts[markup.country]?.percent ?? '', drafts[markup.country]?.shipping ?? '')} />

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
                <input
                  type="text"
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                  placeholder="Country, e.g. Japan"
                  className={`${input} w-48`}
                />
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
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newShipping}
                  onChange={(e) => setNewShipping(e.target.value)}
                  placeholder="0.00"
                  className={`${input} w-32 text-right`}
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
// CREDIT LIMIT
//
// A customer's unpaid balance is what they still owe on all their orders.
// Once it reaches the limit, they can't send new quotation requests or
// approve quotations until they pay. The database enforces it too
// (db/migrations/002_credit_limit.sql).
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
        supabase.from('profiles').select('id, name, company').eq('role', 'customer'),
        supabase.from('customer_orders').select('customer_id, total_amount, settled_amount'),
      ])

      if (customersResult.error) throw customersResult.error
      if (ordersResult.error) throw ordersResult.error

      // The same sum the database uses: what is still owed on every order.
      const owed = {}

      for (const order of ordersResult.data || []) {
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
      toast.error('Enter a credit limit above ₱0.')
      return
    }

    setSaving(true)

    try {
      await saveCreditLimit(value, profile?.id)
      toast.success(`Credit limit set to ${formatPeso(value)}.`)
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


  function creditState(outstanding) {
    if (creditLimit == null) return { label: 'No limit set', className: 'text-gray-500' }
    if (outstanding >= creditLimit) return { label: 'Blocked — must pay first', className: 'font-medium text-red-700' }
    if (outstanding >= creditLimit * 0.8) return { label: 'Near the limit', className: 'font-medium text-amber-700' }
    return { label: 'Can order', className: 'text-green-700' }
  }


  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Credit limit
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        Once a customer's unpaid balance reaches this amount, they can't send new quotation requests or approve quotations until they pay. Every unpaid order counts, including overdue ones.
      </p>

      {loadError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{loadError}</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₱</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveLimit() }}
            disabled={saving}
            placeholder="0.00"
            className="w-48 rounded-md border border-gray-300 bg-white py-2 pl-7 pr-3 text-right text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
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
          Current limit: {creditLimit == null ? 'none' : formatPeso(creditLimit)}
        </span>
      </div>

      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Customer</th>
              <th className={th}>Company</th>
              <th className={th}>Unpaid Balance</th>
              <th className={th}>Status</th>
            </tr>
          </thead>

          <tbody>
            {balances.length > 0 ? (
              balances.map((customer) => {
                const state = creditState(customer.outstanding)

                return (
                  <tr key={customer.id} className="border-t border-gray-200 text-sm">
                    <td className="px-5 py-3 font-medium text-gray-800">{customer.name || '-'}</td>
                    <td className="px-5 py-3">{customer.company || '-'}</td>
                    <td className="px-5 py-3">{formatPeso(customer.outstanding)}</td>
                    <td className={`px-5 py-3 ${state.className}`}>{state.label}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan="4" className="px-5 py-8 text-center text-sm text-gray-500">
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
