'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { createCustomer } from '../services/userService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faPen, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from '../context/ToastContext'

import IconButton from '../components/IconButton'


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


  // =============================================
  // LOAD CUSTOMERS
  // =============================================
  async function loadCustomers() {
    let query = supabase
      .from('profiles')
      .select(`
        id,
        name,
        company,
        contact_number,
        email,
        address,
        country
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

    const { data, error } = await query

    if (error) {
      toast.error(error.message)
      return
    }

    setCustomers(data || [])
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
  // DELETE CUSTOMER
  // =============================================
  async function handleDeleteCustomer(customer) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${customer.name}"?`
    )

    if (!confirmed) {
      return
    }

    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', customer.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadCustomers()
    await loadFilterOptions()

    toast.success('Customer deleted successfully.')
  }


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
        </div>


        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-[#1F3A2C] px-4 py-2 font-medium text-white transition hover:bg-[#2D5A42]"
        >
          + Add Customer
        </button>
      </div>


      {/* Filters */}
      <div className="mb-6 grid grid-cols-3 gap-4">

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
      </div>


      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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

              {profile?.role === 'admin' && (
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Actions
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {customers.length > 0 ? (
              customers.map((customer) => (
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
                    {customer.email}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    {customer.country || '-'}
                  </td>

                  {profile?.role === 'admin' && (
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-start gap-2">
                        <IconButton icon={faPen} title="Edit Customer" color="amber" disabled={false} onClick={() => handleEditCustomer(customer)}/>
                        <IconButton icon={faTrash} title="Delete Customer" color="red" disabled={false} onClick={() => handleDeleteCustomer(customer)}/>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={profile?.role === 'admin' ? 6 : 5} className="py-10 text-center text-sm text-gray-500">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


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
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

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
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

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