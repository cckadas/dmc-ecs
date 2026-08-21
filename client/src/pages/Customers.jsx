'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { createCustomer } from '../services/userService'
import { faFile, faPen, faTrash } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'


export default function CustomersPage() {
  const { toast } = useToast()

  const [customers, setCustomers] = useState([])
  const [showModal, setShowModal] = useState(false)


  // =============================================
  // LOAD CUSTOMERS
  // =============================================
  async function loadCustomers() {
    const { data, error } = await supabase
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

    if (error) {
      toast.error(error.message)
      return
    }

    setCustomers(data)
  }


  // =============================================
  // ADD CUSTOMER - via createCustomer api
  // =============================================
  async function handleAddCustomer(customer) {
    try {
      await createCustomer(customer)
      await loadCustomers()
      toast.success('Customer invited successfully.')
    }
    
    catch (err) {
      toast.error(err.message)
    }
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadCustomers()
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

          <p className="text-gray-500">
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

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {customers.length > 0 ? (
              customers.map((customer) => (
                <tr
                  key={customer.id}
                  className="border-t border-gray-200 text-sm hover:bg-gray-50"
                >
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

                  <td className="px-5 py-3">
                      <div className="flex items-center justify-start gap-2"> 
                        {/* View */} 
                        <IconButton icon={faFile} title="View Customer" color="blue" disabled={false} onClick={() => {}}/>

                        {/* Edit */} 
                        <IconButton icon={faPen} title="Edit Customer" color="amber" disabled={false} onClick={() => {}}/>
                        
                        {/* Delete */} 
                        <IconButton icon={faTrash} title="Delete" color="red" disabled={false} onClick={() => {}}/>
                      </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="py-10 text-center text-sm text-gray-500"
                >
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddCustomerModal
          onClose={() => setShowModal(false)}
          onSubmit={handleAddCustomer}
        />
      )}
    </div>
  )
}


function AddCustomerModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: '',
    company: '',
    contact_number: '',
    email: '',
    address: '',
    country: '',
  })

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    })
  }

  function handleSubmit(e) {
    e.preventDefault()

    if (!form.name || !form.email) return

    onSubmit(form)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Add Customer
          </h2>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 p-6"
        >
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