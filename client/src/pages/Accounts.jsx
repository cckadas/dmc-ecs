'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { createStaffAccount, updateStaffAccountStatus } from '../services/userService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faPowerOff, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import RoleActivityBadge from '../components/RoleActivityBadge'
import IconButton from '../components/IconButton'


export default function AccountsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [accounts, setAccounts] = useState([])
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [company, setCompany] = useState('')
  const [country, setCountry] = useState('')
  const [roles, setRoles] = useState([])
  const [companies, setCompanies] = useState([])
  const [countries, setCountries] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)


  // =============================================
  // LOAD ACCOUNTS
  // =============================================
  async function loadAccounts() {
    let query = supabase
      .from('profiles')
      .select(`
        id,
        name,
        contact_number,
        company,
        email,
        role,
        created_at,
        address,
        country,
        is_active
      `)
      .neq('role', 'customer')
      .order('created_at', { ascending: false })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`
      )
    }

    if (role) {
      query = query.eq('role', role)
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

    setAccounts(data || [])
  }


  // =============================================
  // LOAD FILTER OPTIONS
  // =============================================
  async function loadFilterOptions() {
    const { data, error } = await supabase
      .from('profiles')
      .select('role, company, country')
      .neq('role', 'customer')

    if (error) {
      toast.error(error.message)
      return
    }

    const uniqueRoles = [
      ...new Set(
        (data || [])
          .map((account) => account.role)
          .filter(Boolean)
      )
    ].sort()

    const uniqueCompanies = [
      ...new Set(
        (data || [])
          .map((account) => account.company)
          .filter(Boolean)
      )
    ].sort()

    const uniqueCountries = [
      ...new Set(
        (data || [])
          .map((account) => account.country)
          .filter(Boolean)
      )
    ].sort()

    setRoles(uniqueRoles)
    setCompanies(uniqueCompanies)
    setCountries(uniqueCountries)
  }


  // =============================================
  // CREATE STAFF ACCOUNT
  // =============================================
  async function handleCreateStaff(staff) {
    try {
      await createStaffAccount(staff)
      await loadAccounts()
      await loadFilterOptions()
      setShowModal(false)
      toast.success('Staff account created successfully.')
    }

    catch (err) {
      toast.error(err.message)
    }
  }


  // =============================================
  // ACTIVATE / DEACTIVATE STAFF
  // =============================================
  async function handleToggleAccount(account) {
    const newStatus = !account.is_active

    const action = newStatus ? 'activate' : 'deactivate'
    const confirmed = window.confirm(`Are you sure you want to ${action} "${account.name}"?`)

    if (!confirmed) {
      return
    }

    try {
      await updateStaffAccountStatus(account.id, newStatus)
      await loadAccounts()
      toast.success(`Account ${newStatus ? 'activated' : 'deactivated'} successfully.`)
    }

    catch (err) {
      toast.error(err.message)
    }
  }


  // =============================================
  // VIEW ACCOUNT
  // =============================================
  function handleViewAccount(account) {
    setSelectedAccount(account)
    setShowViewModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadAccounts()
  }, [search, role, company, country])

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
            Accounts
          </h1>

          <p className="mt-1 text-gray-500">
            Manage staff accounts and access.
          </p>
        </div>

        {profile?.role === 'admin' && (
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-[#1F3A2C] px-4 py-2 font-medium text-white transition hover:bg-[#2D5A42]"
          >
            + Add Staff Account
          </button>
        )}
      </div>


      {/* Filters */}
      <div className="mb-6 grid grid-cols-4 gap-4">

        {/* Search */}
        <input
          type="text"
          placeholder="Search account..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-[#2D5A42] focus:outline-none"
        />


        {/* Role */}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option value="">
            All Roles
          </option>

          {roles.map((roleName) => (
            <option key={roleName} value={roleName}>
              {roleName.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </option>
          ))}
        </select>


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
                Name
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Company
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Email
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Country
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Role
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>

              {profile?.role === 'admin' && (
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Actions
                </th>
              )}
            </tr>
          </thead>


          <tbody>
            {accounts.length > 0 ? (
              accounts.map((account) => (
                <tr key={account.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

                  {/* Name */}
                  <td className="px-5 py-3 text-gray-800">
                    {account.name}
                  </td>


                  {/* Company */}
                  <td className="px-5 py-3 text-gray-700">
                    {account.company || '-'}
                  </td>


                  {/* Email */}
                  <td className="px-5 py-3 text-gray-700">
                    {account.email}
                  </td>


                  {/* Contact */}
                  <td className="px-5 py-3 text-gray-700">
                    {account.contact_number || '-'}
                  </td>


                  {/* Country */}
                  <td className="px-5 py-3 text-gray-700">
                    {account.country || '-'}
                  </td>


                  {/* Role */}
                  <td className="px-5 py-3">
                    <RoleActivityBadge status={account.role}/>
                  </td>


                  {/* Status */}
                  <td className="px-5 py-3">
                    <RoleActivityBadge status={account.is_active ? 'active' : 'inactive'}/>
                  </td>


                  {/* Actions */}
                  {profile?.role === 'admin' && (
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-start gap-2">

                        <IconButton
                          icon={faFolderOpen}
                          title="View Account"
                          color="blue"
                          disabled={false}
                          onClick={() => handleViewAccount(account)}
                        />

                        <IconButton
                          icon={faPowerOff}
                          title={account.is_active ? 'Deactivate Account' : 'Activate Account'}
                          color={account.is_active ? 'red' : 'green'}
                          disabled={account.id === profile?.id}
                          onClick={() => handleToggleAccount(account)}
                        />

                      </div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={profile?.role === 'admin' ? 8 : 7} className="py-10 text-center text-sm text-gray-500">
                  No accounts found.
                </td>
              </tr>
            )}
          </tbody>

        </table>
      </div>


      {/* Add Staff Modal */}
      {showModal && (
        <AddStaffModal
          onClose={() => setShowModal(false)}
          onSubmit={handleCreateStaff}
        />
      )}


      {/* View Account Modal */}
      {showViewModal && selectedAccount && (
        <ViewAccountModal
          account={selectedAccount}
          onClose={() => {
            setShowViewModal(false)
            setSelectedAccount(null)
          }}
        />
      )}

    </div>
  )
}





// =============================================
// ADD STAFF MODAL
// =============================================
function AddStaffModal({ onClose, onSubmit }) {

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    contact_number: '',
    company: '',
    address: '',
    country: '',
    role: 'procurement',
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

    if (!form.name || !form.email || !form.password || !form.role) {
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
              Add Staff Account
            </h2>

            <p className="text-sm text-gray-500">
              Register a new staff login account.
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


        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">

            {/* Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>

              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Enter full name"
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


            {/* Password */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Temporary Password
              </label>

              <input
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Enter temporary password"
                minLength={6}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Role */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Role
              </label>

              <select
                name="role"
                value={form.role}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              >
                <option value="admin"> Admin </option>
                <option value="management"> Management </option>
                <option value="sales"> Sales </option>
                <option value="procurement"> Procurement </option>
                <option value="warehouse"> Warehouse </option>
              </select>
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
              />
            </div>


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
                placeholder="Enter company"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
              />
            </div>


            {/* Address */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Address
              </label>

              <input
                type="text"
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="Enter address"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
              Create Staff
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}






// =====================================================
// VIEW CUSTOMER ORDER MODAL
// =====================================================
function ViewAccountModal({ account, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {account.name}
            </h2>

            <p className="text-sm text-gray-500">
              {account.role.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </p>
          </div>

          <button onClick={onClose} className=" rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>


        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="flex-1 overflow-y-auto p-6">


          {/* =================================================
              CUSTOMER INFORMATION
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Customer Information
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-6 rounded-lg bg-gray-50 p-4 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-gray-500"> Name </p>
              <p className="mt-1 font-medium text-gray-800"> {account.name || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Role </p>
              <p className="mt-1 font-medium text-gray-800"> {account.role.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Email </p>
              <p className="mt-1 font-medium text-gray-800"> {account.email || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Contact </p>
              <p className="mt-1 font-medium text-gray-800"> {account.contact_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Company </p>
              <p className="mt-1 font-medium text-gray-800"> {account.company || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Country </p>
              <p className="mt-1 font-medium text-gray-800"> {account.country || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Address </p>
              <p className="mt-1 font-medium text-gray-800"> {account.address || '-'} </p>
            </div>
          </div>
        </div>


        {/* =================================================
            FOOTER
        ================================================= */}
        <div className="flex items-center justify-end gap-3 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  )
}