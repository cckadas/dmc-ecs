import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons'

import IconButton from '../components/IconButton'
import TableScroll from '../components/TableScroll'
import { loadSupplierScores } from '../services/supplierScoreService'
import { LATE_SHARES, RECORD_WEIGHT, USUAL_LATE_FREQUENCY } from '../utils/predictions'
import { countryFrom } from '../utils/estimateInputs'
import { countryName } from '../utils/countryPlaces'


// =============================================
// PREDICTION SETTINGS
//
// DMC staff's usual times, from experience rather than records. The estimates
// lean on them while there are few finished orders, then follow the records
// (utils/predictions.js). Admin and management maintain them; the tables are in
// db/migrations/017.
// =============================================

const th = 'px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#1F3A2C]'
const input = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]'

// Shown when 017 hasn't been run yet, or the tables can't be read.
const settingsErrorMessage = (error) =>
  /prediction_|does not exist|schema cache/i.test(error?.message || '')
    ? 'The prediction settings aren\'t in the database yet. Run database script 017 first.'
    : error?.message || 'Couldn\'t load the prediction settings.'

// How often "sometimes", "rarely" and "often" mean, as a share of deliveries.
const lateShare = (frequency) => `about ${Math.round(LATE_SHARES[frequency] * 100)}%`

const STEPS = [
  { key: 'payment_check', label: "Checking a customer's payment", hint: 'From the proof of payment to sales verifying it' },
  { key: 'ordering', label: 'Ordering from suppliers', hint: 'From the payment being verified to the POs being sent' },
  { key: 'supplier_lead', label: 'Supplier delivery (default)', hint: 'From PO to delivery, for suppliers without their own time below' },
  { key: 'supplier_late_days', label: 'How late suppliers are (default)', hint: `When late, for suppliers without their own number below. They count as late ${USUAL_LATE_FREQUENCY} (${lateShare(USUAL_LATE_FREQUENCY)} of deliveries)` },
  { key: 'labeling', label: 'Labeling: repeat order, 20-ft', hint: 'Every product ordered before by the customer. From all goods arriving to all labels applied' },
  { key: 'labeling_big_container', label: 'Labeling: repeat order, 40-ft', hint: 'Every product ordered before, filling a 40-ft or a 40-ft high cube' },
  { key: 'labeling_new', label: 'Labeling: new customer or product', hint: "The customer's first order, or one with a product they haven't ordered before: its labels are new" },
  { key: 'shipping', label: 'From ready to shipped', hint: 'Booking and loading the container, until it leaves for the port' },
]

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const isWholeOrHalf = (value) => value !== '' && Number(value) >= 0 && Number.isFinite(Number(value))


export default function PredictionSettingsPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Prediction Settings
        </h1>

        <p className="mt-1 max-w-3xl text-gray-500">
          DMC staff's usual times, from experience rather than records. The estimates use them
          while finished orders are few, then follow what really happens: after {RECORD_WEIGHT} finished
          orders a step is half these numbers and half the records, and after 20 it's mostly the records.
        </p>
      </div>

      <StepsSection />
      <SuppliersSection />
      <CountriesSection />
      <BusyMonthsSection />
    </div>
  )
}


// A starting value still waiting for DMC's own number.
function SourceBadge({ placeholder }) {
  return placeholder ? (
    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Placeholder</span>
  ) : (
    <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">DMC's number</span>
  )
}


function LoadError({ message }) {
  if (!message) return null

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-800">{message}</p>
    </div>
  )
}


// =============================================
// EACH STEP'S USUAL DAYS
// =============================================
function StepsSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [rows, setRows] = useState({})
  const [drafts, setDrafts] = useState({})
  const [loadError, setLoadError] = useState('')


  async function loadSteps() {
    const { data, error } = await supabase.from('prediction_settings').select('key, days, is_placeholder')

    if (error) {
      setLoadError(settingsErrorMessage(error))
      return
    }

    const byKey = Object.fromEntries((data || []).map((row) => [row.key, row]))
    setRows(byKey)
    setDrafts(Object.fromEntries(STEPS.map((step) => [step.key, byKey[step.key] ? String(Number(byKey[step.key].days)) : ''])))
    setLoadError('')
  }


  async function saveStep(step) {
    const value = drafts[step.key]

    if (!isWholeOrHalf(value)) {
      toast.error(`Enter the usual days for ${step.label.toLowerCase()}: 0 or more.`)
      return
    }

    const { error } = await supabase
      .from('prediction_settings')
      .upsert(
        { key: step.key, days: Number(value), is_placeholder: false, updated_by: profile?.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`${step.label} saved.`)
    loadSteps()
  }


  useEffect(() => {
    loadSteps()
  }, [])


  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Each step's usual days
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        How many days each step usually takes, in calendar days. The likely range on an estimate runs from 20% quicker to 30% slower than these while records are few.
      </p>

      <LoadError message={loadError} />

      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Step</th>
              <th className={th}>Usual Days</th>
              <th className={th}>Source</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {STEPS.map((step) => (
              <tr key={step.key} className="border-t border-gray-200 text-sm">
                <td className="px-5 py-3">
                  <p className="font-medium text-gray-800">{step.label}</p>
                  <p className="text-xs text-gray-500">{step.hint}</p>
                </td>

                <td className="px-5 py-3">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={drafts[step.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [step.key]: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveStep(step) }}
                    aria-label={`Usual days: ${step.label}`}
                    className={`${input} w-24 text-right`}
                  />
                </td>

                <td className="px-5 py-3">
                  {rows[step.key] && <SourceBadge placeholder={rows[step.key].is_placeholder} />}
                </td>

                <td className="px-5 py-3">
                  <IconButton icon={faFloppyDisk} title={`Save ${step.label}`} color="green" onClick={() => saveStep(step)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  )
}


// =============================================
// EACH SUPPLIER'S USUAL TIMES
// =============================================
function SuppliersSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [scores, setScores] = useState({})
  const [defaultDays, setDefaultDays] = useState(null)
  const [defaultLateDays, setDefaultLateDays] = useState(null)
  const [loadError, setLoadError] = useState('')


  async function loadSuppliers() {
    const [list, saved, fallback, fallbackLate] = await Promise.all([
      supabase.from('suppliers').select('id, supplier_name').order('supplier_name', { ascending: true }),
      supabase.from('prediction_suppliers').select('supplier_id, usual_lead_days, late_frequency, usual_late_days'),
      supabase.from('prediction_settings').select('days').eq('key', 'supplier_lead').maybeSingle(),
      supabase.from('prediction_settings').select('days').eq('key', 'supplier_late_days').maybeSingle(),
    ])

    const error = list.error || saved.error
    if (error) {
      setLoadError(settingsErrorMessage(error))
      return
    }

    const bySupplier = Object.fromEntries((saved.data || []).map((row) => [row.supplier_id, row]))
    const text = (value) => (value === null || value === undefined ? '' : String(Number(value)))

    setSuppliers(list.data || [])
    setDrafts(Object.fromEntries((list.data || []).map((supplier) => {
      const row = bySupplier[supplier.id] || {}
      return [supplier.id, { lead: text(row.usual_lead_days), frequency: row.late_frequency || '', late: text(row.usual_late_days), saved: Boolean(bySupplier[supplier.id]) }]
    })))
    setDefaultDays(fallback.data ? Number(fallback.data.days) : null)
    setDefaultLateDays(fallbackLate.data ? Number(fallbackLate.data.days) : null)
    setLoadError('')

    // What actually happened, beside DMC's numbers. Not needed to save.
    loadSupplierScores((list.data || []).map((supplier) => supplier.id))
      .then(setScores)
      .catch((scoreError) => console.error('Failed to load supplier scores:', scoreError))
  }


  function updateDraft(id, field, value) {
    setDrafts({ ...drafts, [id]: { ...drafts[id], [field]: value } })
  }


  async function saveSupplier(supplier) {
    const draft = drafts[supplier.id] || {}

    if (draft.lead !== '' && !(Number(draft.lead) > 0)) {
      toast.error(`Enter ${supplier.supplier_name}'s usual days from PO to delivery: more than 0.`)
      return
    }

    if (draft.late !== '' && !isWholeOrHalf(draft.late)) {
      toast.error(`Enter how many days ${supplier.supplier_name} is usually late by: 0 or more.`)
      return
    }

    if (draft.lead === '' && draft.frequency === '' && draft.late === '') {
      toast.error(`Enter at least one of ${supplier.supplier_name}'s usual times.`)
      return
    }

    const { error } = await supabase
      .from('prediction_suppliers')
      .upsert(
        {
          supplier_id: supplier.id,
          usual_lead_days: draft.lead === '' ? null : Number(draft.lead),
          late_frequency: draft.frequency || null,
          usual_late_days: draft.late === '' ? null : Number(draft.late),
          updated_by: profile?.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'supplier_id' }
      )

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`${supplier.supplier_name} saved.`)
    loadSuppliers()
  }


  useEffect(() => {
    loadSuppliers()
  }, [])


  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Each supplier's usual times
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        As DMC staff know them. A supplier left blank uses the defaults above: delivery in{defaultDays !== null ? ` ${defaultDays}` : ' the default'} days,
        late {USUAL_LATE_FREQUENCY} ({lateShare(USUAL_LATE_FREQUENCY)} of deliveries) by{defaultLateDays !== null ? ` ${defaultLateDays}` : ' the default'} days.
        Records shows what has actually happened in the last 12 months, for comparison.
      </p>

      <LoadError message={loadError} />

      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Supplier</th>
              <th className={th}>Usual Days, PO to Delivery</th>
              <th className={th}>How Often Late</th>
              <th className={th}>Usually Late By (Days)</th>
              <th className={th}>Records</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {suppliers.map((supplier) => {
              const draft = drafts[supplier.id] || {}
              const score = scores[supplier.id]

              return (
                <tr key={supplier.id} className="border-t border-gray-200 text-sm">
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-800">{supplier.supplier_name}</p>
                    {!draft.saved && <p className="text-xs text-amber-700">Not set: uses the default</p>}
                  </td>

                  <td className="px-5 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={draft.lead ?? ''}
                      onChange={(e) => updateDraft(supplier.id, 'lead', e.target.value)}
                      placeholder={defaultDays !== null ? String(defaultDays) : ''}
                      aria-label={`${supplier.supplier_name}: usual days from PO to delivery`}
                      className={`${input} w-24 text-right`}
                    />
                  </td>

                  <td className="px-5 py-3">
                    <select
                      value={draft.frequency ?? ''}
                      onChange={(e) => updateDraft(supplier.id, 'frequency', e.target.value)}
                      aria-label={`${supplier.supplier_name}: how often late`}
                      className={`${input} w-36`}
                    >
                      <option value="">Not set</option>
                      <option value="rarely">Rarely ({lateShare('rarely')})</option>
                      <option value="sometimes">Sometimes ({lateShare('sometimes')})</option>
                      <option value="often">Often ({lateShare('often')})</option>
                    </select>
                  </td>

                  <td className="px-5 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={draft.late ?? ''}
                      onChange={(e) => updateDraft(supplier.id, 'late', e.target.value)}
                      placeholder={defaultLateDays !== null ? String(defaultLateDays) : ''}
                      aria-label={`${supplier.supplier_name}: usually late by`}
                      className={`${input} w-24 text-right`}
                    />
                  </td>

                  <td className="px-5 py-3 text-xs text-gray-500">
                    {score?.count
                      ? `${score.count} ${score.count === 1 ? 'delivery' : 'deliveries'}, usually ${Math.round(score.usualLeadDays)} days`
                      : 'No deliveries yet'}
                  </td>

                  <td className="px-5 py-3">
                    <IconButton icon={faFloppyDisk} title={`Save ${supplier.supplier_name}`} color="green" onClick={() => saveSupplier(supplier)} />
                  </td>
                </tr>
              )
            })}

            {suppliers.length === 0 && !loadError && (
              <tr>
                <td colSpan="6" className="px-5 py-8 text-center text-sm text-gray-500">
                  No suppliers yet.
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
// SAILING DAYS, BY COUNTRY
//
// DMC: labeling doesn't depend on the country, only on whether the customer or
// a product is new (Each step's usual days), so only sailing days are here.
// =============================================
function CountriesSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [countries, setCountries] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loadError, setLoadError] = useState('')


  async function loadCountries() {
    const [saved, locations] = await Promise.all([
      supabase.from('prediction_countries').select('country, sailing_days, is_placeholder'),
      supabase.from('delivery_locations').select('country'),
    ])

    if (saved.error) {
      setLoadError(settingsErrorMessage(saved.error))
      return
    }

    // Default first, then every country a customer delivers to, saved or not.
    // Names are matched as the estimates match them: "UK" is the United Kingdom.
    const savedRows = saved.data || []
    const byName = new Map(savedRows.map((row) => [countryName(row.country), row]))
    const names = new Map([['default', 'Default']])
    for (const row of savedRows) names.set(countryName(row.country), row.country.trim())
    for (const row of locations.data || []) {
      const name = (row.country || '').trim()
      if (name && !names.has(countryName(name))) names.set(countryName(name), name)
    }

    // One without its own row goes by the nearest that has one (or Default).
    const list = [...names.entries()]
      .map(([key, name]) => {
        const row = byName.get(key) || null
        const borrowed = row ? null : countryFrom(savedRows, name)
        return { key, name, row, nearest: borrowed?.nearest || null, borrowedDays: borrowed?.sailingDays ?? null }
      })
      .sort((a, b) => (a.key === 'default' ? -1 : b.key === 'default' ? 1 : a.name.localeCompare(b.name)))

    const text = (value) => (value === null || value === undefined ? '' : String(Number(value)))

    setCountries(list)
    setDrafts(Object.fromEntries(list.map((country) => [country.key, { sailing: text(country.row?.sailing_days) }])))
    setLoadError('')
  }


  async function saveCountry(country) {
    const draft = drafts[country.key] || {}

    if (draft.sailing !== '' && !(Number(draft.sailing) > 0)) {
      toast.error(`Enter the sailing days to ${country.name}: more than 0.`)
      return
    }

    const { error } = await supabase
      .from('prediction_countries')
      .upsert(
        {
          country: country.row?.country || country.name,
          sailing_days: draft.sailing === '' ? null : Number(draft.sailing),
          is_placeholder: false,
          updated_by: profile?.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'country' }
      )

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(`${country.name} saved.`)
    loadCountries()
  }


  useEffect(() => {
    loadCountries()
  }, [])


  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Sailing days, by country
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        Sailing days give the customer an estimated arrival at their port: the ship date plus these days.
        The system can't learn them, because it doesn't record arrivals. As DMC said, a country without its own row
        goes by the nearest country that has one; Default is for a country the system can't place.
      </p>

      <LoadError message={loadError} />

      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className={th}>Country</th>
              <th className={th}>Sailing Days</th>
              <th className={th}>Source</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {countries.map((country) => (
              <tr key={country.key} className="border-t border-gray-200 text-sm">
                <td className="px-5 py-3 font-medium text-gray-800">
                  {country.name}
                  {!country.row && (
                    <p className="text-xs font-normal text-amber-700">
                      {country.nearest
                        ? `Not set: uses ${country.nearest}'s, the nearest${country.borrowedDays !== null ? ` (${country.borrowedDays} days)` : ''}`
                        : 'Not set: uses Default'}
                    </p>
                  )}
                </td>

                <td className="px-5 py-3">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={drafts[country.key]?.sailing ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [country.key]: { ...drafts[country.key], sailing: e.target.value } })}
                    placeholder={country.borrowedDays !== null && country.borrowedDays !== undefined ? String(country.borrowedDays) : ''}
                    aria-label={`Sailing days to ${country.name}`}
                    className={`${input} w-24 text-right`}
                  />
                </td>

                <td className="px-5 py-3">
                  {country.row && <SourceBadge placeholder={country.row.is_placeholder} />}
                </td>

                <td className="px-5 py-3">
                  <IconButton icon={faFloppyDisk} title={`Save ${country.name}`} color="green" onClick={() => saveCountry(country)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  )
}


// =============================================
// BUSY MONTHS
// =============================================
function BusyMonthsSection() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [drafts, setDrafts] = useState({})
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)


  async function loadMonths() {
    const { data, error } = await supabase.from('prediction_busy_months').select('month, extra_days')

    if (error) {
      setLoadError(settingsErrorMessage(error))
      return
    }

    setDrafts(Object.fromEntries((data || []).map((row) => [row.month, String(Number(row.extra_days))])))
    setLoadError('')
  }


  async function saveMonths() {
    const bad = MONTHS.find((_, index) => !isWholeOrHalf(drafts[index + 1] ?? '0'))

    if (bad) {
      toast.error(`Enter the extra days for ${bad}: 0 or more.`)
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from('prediction_busy_months')
      .upsert(
        MONTHS.map((_, index) => ({
          month: index + 1,
          extra_days: Number(drafts[index + 1] || 0),
          updated_by: profile?.id,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'month' }
      )

    setSaving(false)

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success('Busy months saved.')
    loadMonths()
  }


  useEffect(() => {
    loadMonths()
  }, [])


  return (
    <div>
      <h2 className="text-lg font-semibold text-[#1F3A2C]">
        Busy months
      </h2>

      <p className="mb-3 text-sm text-gray-500">
        Extra days added to a supplier's usual time when its PO is sent in that month. Leave 0 for normal months.
      </p>

      <LoadError message={loadError} />

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {MONTHS.map((name, index) => (
            <label key={name} className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">{name}</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={drafts[index + 1] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [index + 1]: e.target.value })}
                aria-label={`Extra days in ${name}`}
                className={`${input} w-full text-right`}
              />
            </label>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={saveMonths}
            disabled={saving || Boolean(loadError)}
            className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Busy Months'}
          </button>
        </div>
      </div>
    </div>
  )
}
