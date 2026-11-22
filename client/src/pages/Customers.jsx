'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import ExportButton from '../components/ExportButton'
import { exportList } from '../utils/csvExport'
import { useAuth } from '../context/AuthContext'
import { createCustomer } from '../services/userService'
import { previewAccountStep, runAccountStep } from '../services/customerAccounts'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faPen, faXmark, faHand, faUserSlash, faUserCheck, faCreditCard } from '@fortawesome/free-solid-svg-icons'
import { useToast } from '../context/ToastContext'
import { withNewColumns } from '../utils/newColumns'
import { ACCOUNT_COLUMNS, ACCOUNT_STATUS_TEXT, accountStatusOf } from '../utils/customerAccount'
import { creditErrorMessage, formatPeso, getCreditChanges, getCreditLimit, getCreditStatus, setCustomerCredit } from '../services/creditService'

import IconButton from '../components/IconButton'
import RoleActivityBadge from '../components/RoleActivityBadge'
import TableScroll from '../components/TableScroll'


// Which customers are listed, by their account (db/migrations/038).
const STATUS_CHOICES = [
  { value: 'current', label: 'Current customers', test: (status) => status !== 'deleted' },
  { value: 'active', label: 'Active', test: (status) => status === 'active' },
  { value: 'no new orders', label: 'No new orders', test: (status) => status === 'no new orders' },
  { value: 'deactivated', label: 'Deactivated', test: (status) => status === 'deactivated' },
  { value: 'deleted', label: 'Deleted', test: (status) => status === 'deleted' },
  { value: 'all', label: 'All', test: () => true },
]

// What each step is called, and what has happened when it's done.
const STEP_TEXT = {
  stop: { title: 'Stop New Orders', button: 'Stop New Orders' },
  deactivate: { title: 'Deactivate Customer', button: 'Deactivate' },
  activate: { title: 'Activate Customer', button: 'Activate' },
  reopen: { title: 'Allow New Orders Again', button: 'Allow New Orders' },
  delete: { title: 'Delete Customer', button: 'Delete for Good' },
}


// Each customer's credit (db/migrations/047); asked again without it until
// that's run.
const CREDIT_COLUMNS = ['has_credit', 'credit_limit', 'credit_changed_at', 'credit_changed_by_name']

export default function CustomersPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [customers, setCustomers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('')
  const [country, setCountry] = useState('')
  const [companies, setCompanies] = useState([])
  const [countries, setCountries] = useState([])
  // Which accounts are listed, the latest step on each, and the step being
  // confirmed: { customer, step } (db/migrations/038).
  const [status, setStatus] = useState('current')
  const [accountChanges, setAccountChanges] = useState({})
  const [accountStep, setAccountStep] = useState(null)
  const [creditCustomer, setCreditCustomer] = useState(null)
  const isAdmin = profile?.role === 'admin'


  // =============================================
  // LOAD CUSTOMERS
  // =============================================
  async function loadCustomers() {
    const { data, error } = await withNewColumns((withCredit) => withNewColumns((withAccount) => {
      let query = supabase
        .from('profiles')
        .select(`
          id,
          name,
          company,
          contact_number,
          email,
          address,
          country,
          is_active
          ${withAccount ? `, ${ACCOUNT_COLUMNS.join(', ')}` : ''}
          ${withCredit ? `, ${CREDIT_COLUMNS.join(', ')}` : ''}
        `)
        .eq('role', 'customer')
        .order('created_at', { ascending: false })

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`
        )
      }

      if (company) {
        query = query.eq('company', company)
      }

      if (country) {
        query = query.eq('country', country)
      }

      return query
    }, ACCOUNT_COLUMNS), CREDIT_COLUMNS)

    if (error) {
      toast.error(error.message)
      return
    }

    setCustomers(data || [])
    loadAccountChanges()
  }


  // =============================================
  // EACH ACCOUNT'S LATEST STEP (none before 038 is run)
  // =============================================
  async function loadAccountChanges() {
    const { data, error } = await supabase
      .from('customer_account_changes')
      .select('customer_id, action, done_by_name, done_at')
      .order('done_at', { ascending: false })

    if (error) return

    const latest = {}
    for (const change of data || []) {
      if (!latest[change.customer_id]) latest[change.customer_id] = change
    }
    setAccountChanges(latest)
  }


  // =============================================
  // LOAD FILTER OPTIONS
  // =============================================
  async function loadFilterOptions() {
    const { data, error } = await supabase
      .from('profiles')
      .select('company, country')
      .eq('role', 'customer')

    if (error) {
      toast.error(error.message)
      return
    }

    const uniqueCompanies = [
      ...new Set(
        (data || [])
          .map((customer) => customer.company)
          .filter(Boolean)
      ),
    ].sort()

    const uniqueCountries = [
      ...new Set(
        (data || [])
          .map((customer) => customer.country)
          .filter(Boolean)
      ),
    ].sort()

    setCompanies(uniqueCompanies)
    setCountries(uniqueCountries)
  }


  // =============================================
  // ADD CUSTOMER
  // =============================================
  async function handleAddCustomer(customer) {
    try {
      await createCustomer(customer)
      await loadCustomers()
      await loadFilterOptions()
      toast.success('Customer invited successfully.')
    }
    
    catch (err) {
      toast.error(err.message)
    }
  }


  // =============================================
  // UPDATE CUSTOMER
  // =============================================
  async function handleUpdateCustomer(updatedCustomer) {
    const { error } = await supabase
      .from('profiles')
      .update({
        name: updatedCustomer.name,
        company: updatedCustomer.company,
        contact_number: updatedCustomer.contact_number,
        email: updatedCustomer.email,
        address: updatedCustomer.address,
        country: updatedCustomer.country,
      })
      .eq('id', updatedCustomer.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadCustomers()
    await loadFilterOptions()

    setShowEditModal(false)
    setEditingCustomer(null)

    toast.success('Customer updated successfully.')
  }


  // =============================================
  // AFTER A STEP ON A CUSTOMER'S ACCOUNT
  // (stop new orders, deactivate, activate, delete: AccountStepModal)
  // =============================================
  async function handleAccountStepDone() {
    setAccountStep(null)
    await loadCustomers()
    await loadFilterOptions()
  }

  const shownCustomers = customers.filter((customer) =>
    (STATUS_CHOICES.find((choice) => choice.value === status) || STATUS_CHOICES[0]).test(accountStatusOf(customer)))


  // =============================================
  // OPEN EDIT MODAL
  // =============================================
  function handleEditCustomer(customer) {
    setEditingCustomer(customer)
    setShowEditModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadCustomers()
  }, [search, company, country])

  useEffect(() => {
    loadFilterOptions()
  }, [])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Customers
          </h1>

          <p className="mt-1 text-gray-500">
            Manage customer records.
          </p>

          <ExportButton className="mt-3" count={shownCustomers.length} onExport={(how) => exportList(how, 'customers', CUSTOMER_COLUMNS, shownCustomers)} />
        </div>


        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-[#1F3A2C] px-4 py-2 font-medium text-white transition hover:bg-[#2D5A42]"
        >
          + Add Customer
        </button>
      </div>


      {/* Filters */}
      <div className="mb-6 grid grid-cols-4 gap-4">

        {/* Search */}
        <input
          type="text"
          placeholder="Search customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-[#2D5A42] focus:outline-none"
        />


        {/* Company */}
        <select
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option value="">
            All Companies
          </option>

          {companies.map((companyName) => (
            <option key={companyName} value={companyName}>
              {companyName}
            </option>
          ))}
        </select>


        {/* Country */}
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option value="">
            All Countries
          </option>

          {countries.map((countryName) => (
            <option key={countryName} value={countryName}>
              {countryName}
            </option>
          ))}
        </select>


        {/* Account */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Account"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          {STATUS_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>


      {/* Table */}
      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">

          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact Person
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Company
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Email
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Country
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Account
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Credit
              </th>

              {isAdmin && (
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Actions
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {shownCustomers.length > 0 ? (
              shownCustomers.map((customer) => (
                <tr key={customer.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-800">
                    {customer.name}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    {customer.company || '-'}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    {customer.contact_number || '-'}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    {customer.erased_at ? '-' : customer.email}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    {customer.country || '-'}
                  </td>

                  <td className="px-5 py-3">
                    <RoleActivityBadge status={accountStatusOf(customer)}/>
                    {accountStatusOf(customer) !== 'active' && accountChanges[customer.id] && (
                      <span className="mt-1 block text-xs text-gray-500">
                        {new Date(accountChanges[customer.id].done_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {accountChanges[customer.id].done_by_name ? `, by ${accountChanges[customer.id].done_by_name}` : ''}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    <CreditCell customer={customer}/>
                  </td>

                  {isAdmin && (
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-start gap-2">
                        {accountStatusOf(customer) !== 'deleted' && (
                          <IconButton icon={faPen} title="Edit Customer" color="amber" disabled={false} onClick={() => handleEditCustomer(customer)}/>
                        )}
                        {accountStatusOf(customer) !== 'deleted' && customer.has_credit !== undefined && (
                          <IconButton icon={faCreditCard} title="Credit: give, change or remove" color="green" disabled={false} onClick={() => setCreditCustomer(customer)}/>
                        )}
                        {accountStatusOf(customer) === 'active' && (
                          <IconButton icon={faHand} title="Stop new orders (they finish what's paid)" color="amber" disabled={false} onClick={() => setAccountStep({ customer, step: 'stop' })}/>
                        )}
                        {['active', 'no new orders'].includes(accountStatusOf(customer)) && (
                          <IconButton icon={faUserSlash} title="Deactivate (can't sign in)" color="red" disabled={false} onClick={() => setAccountStep({ customer, step: 'deactivate' })}/>
                        )}
                        {accountStatusOf(customer) === 'no new orders' && (
                          <IconButton icon={faUserCheck} title="Allow new orders again" color="green" disabled={false} onClick={() => setAccountStep({ customer, step: 'activate' })}/>
                        )}
                        {accountStatusOf(customer) === 'deactivated' && (
                          <>
                            <IconButton icon={faUserCheck} title="Activate again" color="green" disabled={false} onClick={() => setAccountStep({ customer, step: 'activate' })}/>
                            <IconButton icon={faTrash} title="Delete for good" color="red" disabled={false} onClick={() => setAccountStep({ customer, step: 'delete' })}/>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} className="py-10 text-center text-sm text-gray-500">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>


      {/* ADD CUSTOMER MODAL */}
      {showModal && (
        <AddCustomerModal
          onClose={() => setShowModal(false)}
          onSubmit={handleAddCustomer}
        />
      )}


      {/* EDIT CUSTOMER MODAL */}
      {showEditModal && editingCustomer && (
        <EditCustomerModal
          customer={editingCustomer}
          onClose={() => {
            setShowEditModal(false)
            setEditingCustomer(null)
          }}
          onSubmit={handleUpdateCustomer}
        />
      )}


      {/* STOP NEW ORDERS / DEACTIVATE / ACTIVATE / DELETE */}
      {accountStep && (
        <AccountStepModal
          customer={accountStep.customer}
          step={accountStep.step}
          onClose={() => setAccountStep(null)}
          onDone={handleAccountStepDone}
        />
      )}


      {/* GIVE, CHANGE OR REMOVE CREDIT (047) */}
      {creditCustomer && (
        <CreditModal
          customer={creditCustomer}
          onClose={() => setCreditCustomer(null)}
          onDone={() => {
            setCreditCustomer(null)
            loadCustomers()
          }}
        />
      )}

    </div>
  )
}





// =============================================
// A STEP ON A CUSTOMER'S ACCOUNT (db/migrations/038)
// Asks the server what the step would do (or why it can't), shows it, and
// does it once confirmed.
// =============================================
function AccountStepModal({ customer, step, onClose, onDone }) {
  const { toast } = useToast()
  const [preview, setPreview] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [running, setRunning] = useState(false)
  const [understood, setUnderstood] = useState(false)

  const reopening = step === 'activate' && accountStatusOf(customer) === 'no new orders'
  const text = STEP_TEXT[reopening ? 'reopen' : step]
  const label = preview?.customer?.label || customer.company || customer.name

  async function load() {
    setLoadError('')
    try {
      setPreview(await previewAccountStep(customer.id, step))
    } catch (error) {
      setLoadError(error.message)
    }
  }

  // Once per window: the customer and step don't change while it's open.
  useEffect(() => {
    load()
  }, [])

  async function confirm() {
    setRunning(true)
    try {
      const { result, signInWarning } = await runAccountStep(customer.id, step)
      const name = result?.customer?.label || label
      const done = {
        stopped: `New orders stopped for ${name}. They can still pay and follow their orders.`,
        deactivated: `${name} is deactivated: they can't sign in. Their records stay.`,
        activated: reopening ? `${name} can order again.` : `${name} is active again and can sign in.`,
        erased: `${name} was deleted: their sign-in and personal details are gone. Their orders, quotations and payments stay, under "Deleted customer".`,
        deleted: `${name} was deleted.`,
      }[result?.result] || 'Done.'
      toast.success(done)
      if (signInWarning) toast.error(signInWarning)
      onDone()
    } catch (error) {
      toast.error(error.message)
      setRunning(false)
      load()
    }
  }

  const list = (entries, show) => (entries || []).map(show).join(', ')
  const cancels = preview && (preview.cancel_orders?.length || preview.withdraw_quotations?.length || preview.cancel_requests?.length)
  const carriesOn = preview && (preview.carry_on?.length || preview.payment_checks?.length || preview.balances?.length)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl">

        <div className="flex items-center justify-between border-b bg-[#F4F8F5] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">{text.title}</h2>
            <p className="text-sm text-gray-500">{label}</p>
          </div>

          <button type="button" onClick={onClose} disabled={running} className="rounded-md p-2 text-gray-500 transition hover:bg-white hover:text-gray-700">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>

        <div className="space-y-4 p-6 text-sm text-gray-700">
          {loadError && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{loadError}</p>
          )}

          {!preview && !loadError && <p className="text-gray-500">Checking their orders...</p>}

          {preview && (
            <>
              <p>
                {step === 'stop' && `${label} can still sign in, pay what they owe, handle labels and follow their orders until they're done. They can't send quotation requests, approve quotations, ask for a new quote or start a rush shipment.`}
                {step === 'deactivate' && `${label} can't sign in any more. Every order, quotation and payment stays on record, and you can activate them again.`}
                {step === 'activate' && (reopening
                  ? `${label} can send quotation requests and place orders again. What was cancelled stays cancelled.`
                  : `${label} can sign in and order again. What was cancelled stays cancelled.`)}
                {step === 'delete' && (preview.erases
                  ? `${label}'s sign-in, name, email, phone and addresses are erased for good. Their ${preview.records?.orders || 0} order(s), quotations, PFIs and payments stay, under "Deleted customer", each with its delivery country.`
                  : `${label} has no orders or requests: their account and saved delivery locations are deleted for good.`)}
              </p>

              {!preview.allowed && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{preview.refusal}</p>
              )}

              {preview.allowed && ['stop', 'deactivate'].includes(step) && (
                <div className="space-y-3">
                  {cancels ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="font-medium text-amber-800">Cancelled now, as nothing was paid for them (kept on record):</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900">
                        {preview.cancel_orders?.length > 0 && <li>Orders: {list(preview.cancel_orders, (order) => `${order.number} (${order.status})`)}</li>}
                        {preview.withdraw_quotations?.length > 0 && <li>Quotations withdrawn: {list(preview.withdraw_quotations, (quotation) => `${quotation.number} (${quotation.request})`)}</li>}
                        {preview.cancel_requests?.length > 0 && <li>Requests: {list(preview.cancel_requests, (reference) => reference)}</li>}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-gray-500">Nothing is cancelled: no unpaid orders or open quotations.</p>
                  )}

                  {step === 'stop' && carriesOn > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="font-medium text-gray-800">Carry on to the end:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {preview.carry_on?.length > 0 && <li>{list(preview.carry_on, (order) => `${order.number} (${order.status})`)}</li>}
                        {preview.payment_checks?.length > 0 && <li>Payment waiting for sales' check: {list(preview.payment_checks, (order) => order.number)}</li>}
                        {preview.balances?.length > 0 && <li>Balance still to pay: {list(preview.balances, (order) => `${order.number} (${formatPeso(order.amount)})`)}</li>}
                      </ul>
                      <p className="mt-2 text-xs text-gray-500">Once these are shipped and paid, you can deactivate them.</p>
                    </div>
                  )}
                </div>
              )}

              {preview.allowed && step === 'delete' && (
                <label className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                  <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-0.5 h-4 w-4 accent-red-600"/>
                  <span>I understand this can't be undone.</span>
                </label>
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={running} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50">
              {preview && !preview.allowed ? 'Close' : 'Cancel'}
            </button>

            {preview?.allowed && (
              <button
                type="button"
                onClick={confirm}
                disabled={running || (step === 'delete' && !understood)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${['deactivate', 'delete'].includes(step) ? 'bg-red-600 hover:bg-red-700' : 'bg-[#1F3A2C] hover:bg-[#2D5A42]'}`}
              >
                {running ? 'Working...' : text.button}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}





// =============================================
// ADD CUSTOMER MODAL
// =============================================
function AddCustomerModal({ onClose, onSubmit }) {

  const [form, setForm] = useState({
    name: '',
    company: '',
    contact_number: '',
    email: '',
    address: '',
    country: '',
  })


  // =============================================
  // HADNLE CHANGE
  // =============================================
  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }


  // =============================================
  //HANDLE SUBMIT
  // =============================================
  function handleSubmit(e) {
    e.preventDefault()

    if (!form.name || !form.email) {
      return
    }

    onSubmit(form)
    onClose()
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">

        {/* HEADER */}
        <div className="flex items-center justify-between border-b bg-[#F4F8F5] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">
              Add Customer
            </h2>

            <p className="text-sm text-gray-500">
              Register a new customer to the system.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 transition hover:bg-white hover:text-gray-700"
          >
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>


        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">

            {/* Company */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Company
              </label>

              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                placeholder="Enter company name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Contact Person */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Person
              </label>

              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Enter contact person's name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Email */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>

              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="Enter email address"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Contact Number */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Number
              </label>

              <input
                type="text"
                name="contact_number"
                value={form.contact_number}
                onChange={handleChange}
                placeholder="Enter contact number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Country */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Country
              </label>

              <input
                type="text"
                name="country"
                value={form.country}
                onChange={handleChange}
                placeholder="Enter country"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Address */}
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Address
              </label>

              <textarea
                name="address"
                value={form.address}
                onChange={handleChange}
                rows={3}
                placeholder="Enter address"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>
          </div>


          <div className="flex justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 transition hover:bg-gray-100"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="rounded-lg bg-[#1F3A2C] px-4 py-2 text-white transition hover:bg-[#2D5A42]"
            >
              Save Customer
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}





// =============================================
// EDIT CUSTOMER MODAL
// =============================================
function EditCustomerModal({ customer, onClose, onSubmit }) {

  const [form, setForm] = useState({
    id: customer.id,
    name: customer.name || '',
    company: customer.company || '',
    contact_number: customer.contact_number || '',
    email: customer.email || '',
    address: customer.address || '',
    country: customer.country || '',
  })


  // =============================================
  // HANDLE CHANGE
  // =============================================
  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }


  // =============================================
  // HANDLE SUBMIT
  // =============================================
  function handleSubmit(e) {
    e.preventDefault()

    if (!form.name || !form.email || !form.company || !form.contact_number || !form.country || !form.address) {
      return
    }

    onSubmit(form)
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b bg-[#F4F8F5] px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1F3A2C]">
              Edit Customer
            </h2>

            <p className="text-sm text-gray-500">
              Update customer information.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 transition hover:bg-white hover:text-gray-700"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>


        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">

            {/* Company */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Company
              </label>

              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Contact Person */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Person
              </label>

              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Email */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>

              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Contact Number */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Number
              </label>

              <input
                type="text"
                name="contact_number"
                value={form.contact_number}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Country */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Country
              </label>

              <input
                type="text"
                name="country"
                value={form.country}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Address */}
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Address
              </label>

              <textarea
                name="address"
                value={form.address}
                onChange={handleChange}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>
          </div>


          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="rounded-lg bg-[#1F3A2C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2D5A42]"
            >
              Save Changes
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per customer, as listed.
// =============================================
const CUSTOMER_COLUMNS = [
  { header: 'Name', value: (customer) => customer.name },
  { header: 'Company', value: (customer) => customer.company },
  { header: 'Email', value: (customer) => (customer.erased_at ? '' : customer.email) },
  { header: 'Contact number', value: (customer) => customer.contact_number },
  { header: 'Address', value: (customer) => customer.address },
  { header: 'Country', value: (customer) => customer.country },
  { header: 'Account', value: (customer) => ACCOUNT_STATUS_TEXT[accountStatusOf(customer)] },
]



// =============================================
// A CUSTOMER'S CREDIT, FOR THE LIST (db/migrations/047)
// =============================================
const formatDay = (value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function CreditCell({ customer }) {
  if (customer.has_credit === undefined) return <span className="text-gray-400">-</span>

  const kept = customer.credit_changed_by_name === 'Kept from before'

  return (
    <>
      {customer.has_credit
        ? <span className="font-medium text-gray-800">Up to {formatPeso(customer.credit_limit)}</span>
        : <span className="text-gray-500">No credit</span>}
      {customer.credit_changed_at && (
        <span className="mt-1 block text-xs text-gray-500">
          {kept ? 'Kept from before' : formatDay(customer.credit_changed_at)}
          {!kept && customer.credit_changed_by_name ? `, by ${customer.credit_changed_by_name}` : ''}
        </span>
      )}
    </>
  )
}


// =============================================
// GIVE, CHANGE OR REMOVE A CUSTOMER'S CREDIT (admin, db/migrations/047)
// With credit, a customer may owe DMC up to their own limit. Without it, they
// have one unpaid order at a time and pay each order in full before it ships.
// =============================================
const CHANGE_TEXT = {
  'kept from before': (change) => `Credit kept from before, up to ${formatPeso(change.credit_limit)}`,
  given: (change) => `Credit given, up to ${formatPeso(change.credit_limit)}`,
  'limit changed': (change) => `Limit changed from ${formatPeso(change.previous_limit)} to ${formatPeso(change.credit_limit)}`,
  removed: (change) => `Credit removed${change.previous_limit != null ? ` (was up to ${formatPeso(change.previous_limit)})` : ''}`,
}

function CreditModal({ customer, onClose, onDone }) {
  const { toast } = useToast()
  const [hasCredit, setHasCredit] = useState(Boolean(customer.has_credit))
  const [limit, setLimit] = useState(customer.has_credit ? String(Number(customer.credit_limit)) : '')
  const [owed, setOwed] = useState(null)
  const [changes, setChanges] = useState([])
  const [saving, setSaving] = useState(false)
  const label = customer.company || customer.name || 'This customer'

  useEffect(() => {
    getCreditStatus(customer.id).then((status) => setOwed(status.outstanding)).catch(() => setOwed(null))
    getCreditChanges(customer.id).then(setChanges).catch(() => setChanges([]))

    // A first limit starts from the standard one (Markups & Credit).
    if (!customer.has_credit) {
      getCreditLimit()
        .then((standard) => { if (standard != null) setLimit((current) => current || String(standard)) })
        .catch(() => {})
    }
  }, [customer.id, customer.has_credit])

  const value = Number(limit)
  const unchanged = hasCredit === Boolean(customer.has_credit) && (!hasCredit || value === Number(customer.credit_limit))
  const owesNow = owed != null && owed > 0.009


  async function save() {
    if (hasCredit && !(value > 0)) {
      toast.error('Type the credit limit, above ₱0.')
      return
    }

    setSaving(true)

    try {
      const result = await setCustomerCredit(customer.id, hasCredit, hasCredit ? value : null)
      toast.success(
        !result?.changed ? 'Nothing changed.'
          : result.kind === 'given' ? `${label} has credit now, up to ${formatPeso(value)}.`
            : result.kind === 'removed' ? `${label} has no credit now.`
              : `${label}'s credit limit is now ${formatPeso(value)}.`
      )
      onDone()
    } catch (error) {
      toast.error(creditErrorMessage(error))
      setSaving(false)
    }
  }


  const choice = (selected) => `flex cursor-pointer gap-3 rounded-lg border p-3 ${selected ? 'border-[#2D5A42] bg-[#F4F8F5]' : 'border-gray-200 hover:bg-gray-50'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Credit</h2>
            <p className="text-sm text-gray-500">{label}</p>
          </div>

          <button onClick={onClose} disabled={saving} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 text-sm">
          <p className="text-gray-700">
            Now: {customer.has_credit
              ? <>credit up to <span className="font-medium">{formatPeso(customer.credit_limit)}</span></>
              : 'no credit'}
            {owed != null && <>. They owe {formatPeso(owed)} on their orders</>}.
          </p>

          <label className={choice(hasCredit)}>
            <input type="radio" name="credit" checked={hasCredit} onChange={() => setHasCredit(true)} disabled={saving} className="mt-1"/>
            <span className="flex-1">
              <span className="block font-medium text-gray-800">Credit, up to a limit</span>
              <span className="block text-gray-600">
                They may owe DMC up to this amount: their orders can ship before they're paid in full, and they can approve new orders while others are unpaid.
              </span>
              {hasCredit && (
                <span className="relative mt-2 block w-48">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₱</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    disabled={saving}
                    placeholder="0.00"
                    className="w-full rounded-md border border-gray-300 bg-white py-2 pl-7 pr-3 text-right text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
                  />
                </span>
              )}
            </span>
          </label>

          <label className={choice(!hasCredit)}>
            <input type="radio" name="credit" checked={!hasCredit} onChange={() => setHasCredit(false)} disabled={saving} className="mt-1"/>
            <span className="flex-1">
              <span className="block font-medium text-gray-800">No credit</span>
              <span className="block text-gray-600">
                One unpaid order at a time: they pay each order in full before it ships, and before they can approve another.
              </span>
            </span>
          </label>

          {hasCredit && owesNow && value > 0 && owed >= value && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
              They already owe {formatPeso(owed)}, which reaches this limit: they can't send new requests or approve quotations until they pay it down.
            </p>
          )}

          {!hasCredit && customer.has_credit && owesNow && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
              They owe {formatPeso(owed)}: without credit, each of those orders ships only once it's paid in full, and they can't approve a new order until they've paid.
            </p>
          )}

          {changes.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Changes</p>
              <ul className="mt-1 space-y-1 text-xs text-gray-600">
                {changes.map((change) => (
                  <li key={change.id}>
                    {formatDay(change.changed_at)}: {(CHANGE_TEXT[change.kind] || (() => change.kind))(change)}
                    {change.kind !== 'kept from before' && change.changed_by_name ? `, by ${change.changed_by_name}` : ''}
                    {` (owed ${formatPeso(change.owed_then)} then)`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            onClick={save}
            disabled={saving || unchanged}
            className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
