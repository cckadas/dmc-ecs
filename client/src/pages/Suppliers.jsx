'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faPen, faTrash, faFileImport } from '@fortawesome/free-solid-svg-icons'
import { useToast } from '../context/ToastContext'

import IconButton from '../components/IconButton'


export default function SuppliersPage() {
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState(null)


  // =============================================
  // LOAD SUPPLIERS
  // =============================================
  async function loadSuppliers() {
    const { data, error } = await supabase
      .from('suppliers')
      .select(`
        id,
        supplier_name,
        supplier_type,
        contact_person,
        email,
        phone,
        address,
        created_at
      `)
      .order('created_at', { ascending: false })

    if (error) {
      toast.error(error.message)
      return
    }

    setSuppliers(data || [])
  }


  // =============================================
  // ADD SUPPLIER
  // =============================================
  async function handleAddSupplier(supplier) {
    const { error } = await supabase
      .from('suppliers')
      .insert([supplier])

    if (error) {
      toast.error(error.message)
      return
    }

    await loadSuppliers()

    toast.success('Supplier added successfully.')
  }


  // =============================================
  // BULK IMPORT SUPPLIERS
  // =============================================
  async function handleImportSuppliers(suppliers) {
    if (!suppliers || suppliers.length === 0) {
      toast.error('No valid suppliers found in the file.')
      return
    }

    const { error } = await supabase
      .from('suppliers')
      .insert(suppliers)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadSuppliers()

    setShowImportModal(false)

    toast.success(
      `${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''} imported successfully.`
    )
  }


  // =============================================
  // UPDATE SUPPLIER
  // =============================================
  async function handleUpdateSupplier(updatedSupplier) {
    const { error } = await supabase
      .from('suppliers')
      .update({
        supplier_name: updatedSupplier.supplier_name,
        supplier_type: updatedSupplier.supplier_type,
        contact_person: updatedSupplier.contact_person,
        email: updatedSupplier.email,
        phone: updatedSupplier.phone,
        address: updatedSupplier.address,
      })
      .eq('id', updatedSupplier.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadSuppliers()

    setShowEditModal(false)
    setSelectedSupplier(null)

    toast.success('Supplier updated successfully.')
  }


  // =============================================
  // DELETE SUPPLIER
  // =============================================
  async function handleDeleteSupplier(supplier) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${supplier.supplier_name}"?`
    )

    if (!confirmed) {
      return
    }

    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', supplier.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadSuppliers()

    toast.success('Supplier deleted successfully.')
  }


  // =============================================
  // VIEW SUPPLIER
  // =============================================
  function handleViewSupplier(supplier) {
    setSelectedSupplier(supplier)
    setShowViewModal(true)
  }


  // =============================================
  // EDIT SUPPLIER
  // =============================================
  function handleEditSupplier(supplier) {
    setSelectedSupplier(supplier)
    setShowEditModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadSuppliers()
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
            Suppliers
          </h1>

          <p className="text-gray-500">
            Manage supplier records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 rounded-lg border border-[#2D5A42] bg-white px-4 py-2 font-medium text-[#1F3A2C] transition hover:bg-[#F4F8F5]"
          >
            <FontAwesomeIcon icon={faFileImport} />
            Import Suppliers
          </button>

          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-[#1F3A2C] px-4 py-2 font-medium text-white transition hover:bg-[#2D5A42]"
          >
            + Add Supplier
          </button>
        </div>
      </div>


      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Supplier
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Type
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact Person
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Address
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {suppliers.length > 0 ? (
              suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

                  {/* Supplier */}
                  <td className="px-5 py-3 text-gray-800">
                    <p className="font-medium">
                      {supplier.supplier_name}
                    </p>

                    {supplier.email && (
                      <p className="text-xs text-gray-500">
                        {supplier.email}
                      </p>
                    )}
                  </td>


                  {/* Supplier Type */}
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium
                        ${ 
                          supplier.supplier_type === 'Manufacturer'
                            ? 'bg-blue-100 text-blue-700'
                            : supplier.supplier_type === 'Supermarket'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-amber-100 text-amber-700'
                        }
                      `}
                    >
                      {supplier.supplier_type}
                    </span>
                  </td>


                  {/* Contact Person */}
                  <td className="px-5 py-3 text-gray-700">
                    {supplier.contact_person || '-'}
                  </td>


                  {/* Contact */}
                  <td className="px-5 py-3 text-gray-700">
                    {supplier.phone ? (
                      <p>{supplier.phone}</p>
                    ) : (
                      <p className="text-gray-400">-</p>
                    )}

                  </td>


                  {/* Address */}
                  <td className="max-w-xs px-5 py-3 text-gray-700">
                    <p className="truncate">
                      {supplier.address || '-'}
                    </p>
                  </td>


                  {/* Actions */}
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-start gap-2">

                    {/* View */}
                    <IconButton icon={faFolderOpen} title="View Supplier" color="blue" disabled={false} onClick={() => handleViewSupplier(supplier)}/>

                    {/* Edit */}
                    <IconButton icon={faPen} title="Edit Supplier" color="amber" disabled={false} onClick={() => handleEditSupplier(supplier)}/>

                    {/* Delete */}
                    <IconButton icon={faTrash} title="Delete Supplier" color="red" disabled={false} onClick={() => handleDeleteSupplier(supplier)}/>

                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-gray-500">
                  No suppliers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


      {showModal && (
        <AddSupplierModal
          onClose={() => setShowModal(false)}
          onSubmit={handleAddSupplier}
        />
      )}


      {showImportModal && (
        <ImportSuppliersModal
          onClose={() => setShowImportModal(false)}
          onSubmit={handleImportSuppliers}
        />
      )}


      {showViewModal && selectedSupplier && (
        <ViewSupplierModal
          supplier={selectedSupplier}
          onClose={() => {
            setShowViewModal(false)
            setSelectedSupplier(null)
          }}
        />
      )}


      {showEditModal && selectedSupplier && (
        <EditSupplierModal
          supplier={selectedSupplier}
          onClose={() => {
            setShowEditModal(false)
            setSelectedSupplier(null)
          }}
          onSubmit={handleUpdateSupplier}
        />
      )}

    </div>
  )
}



// =============================================
// ADD SUPPLIER MODAL
// =============================================
function AddSupplierModal({ onClose, onSubmit }) {

  const [form, setForm] = useState({
    supplier_name: '',
    supplier_type: 'Manufacturer',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
  })


  // =============================================
  // HANDLE CHANGE
  // =============================================
  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    })
  }


  // =============================================
  // HANDLE SUBMIT
  // =============================================
  function handleSubmit(e) {
    e.preventDefault()

    if (!form.supplier_name || !form.supplier_type) {
      return
    }

    onSubmit(form)
    onClose()
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Add Supplier
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">

            {/* Supplier Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Supplier Name
              </label>

              <input
                type="text"
                name="supplier_name"
                value={form.supplier_name}
                onChange={handleChange}
                placeholder="Enter supplier name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Supplier Type */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Supplier Type
              </label>

              <select
                name="supplier_type"
                value={form.supplier_type}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              >

                <option value="Manufacturer">
                  Manufacturer
                </option>

                <option value="Distributor">
                  Distributor
                </option>

                <option value="Supermarket">
                  Supermarket
                </option>
              </select>
            </div>


            {/* Contact Person */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Person
              </label>

              <input
                type="text"
                name="contact_person"
                value={form.contact_person}
                onChange={handleChange}
                placeholder="Enter contact person's name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
              />
            </div>


            {/* Phone */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Phone
              </label>

              <input
                type="text"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="Enter phone number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
                placeholder="Enter supplier address"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
              />
            </div>

          </div>


          {/* Buttons */}
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
              Save Supplier
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}



// =============================================
// VIEW SUPPLIER MODAL
// =============================================
function ViewSupplierModal({ supplier, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Supplier Details
          </h2>

          <p className="text-sm text-gray-500">
            View supplier information.
          </p>
        </div>


        {/* Content */}
        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-5">

            {/* Supplier Name */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Supplier Name
              </p>

              <p className="mt-1 font-medium text-gray-800">
                {supplier.supplier_name}
              </p>
            </div>


            {/* Supplier Type */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Supplier Type
              </p>

              <span
                className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium
                  ${
                    supplier.supplier_type === 'Manufacturer'
                      ? 'bg-blue-100 text-blue-700'
                      : supplier.supplier_type === 'Supermarket'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-amber-100 text-amber-700'
                  }
                `}
              >
                {supplier.supplier_type}
              </span>
            </div>


            {/* Contact Person */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Contact Person
              </p>

              <p className="mt-1 text-gray-800">
                {supplier.contact_person || '-'}
              </p>
            </div>


            {/* Email */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Email
              </p>

              <p className="mt-1 text-gray-800">
                {supplier.email || '-'}
              </p>
            </div>


            {/* Phone */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Phone
              </p>

              <p className="mt-1 text-gray-800">
                {supplier.phone || '-'}
              </p>
            </div>


            {/* Created */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Created
              </p>

              <p className="mt-1 text-gray-800">
                {supplier.created_at ? new Date(supplier.created_at).toLocaleDateString() : '-'}
              </p>
            </div>


            {/* Address */}
            <div className="col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Address
              </p>

              <p className="mt-1 text-gray-800">
                {supplier.address || '-'}
              </p>
            </div>
          </div>


          {/* Close */}
          <div className="flex justify-end pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Close
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}



// =============================================
// EDIT SUPPLIER MODAL
// =============================================
function EditSupplierModal({ supplier, onClose, onSubmit }) {

  const [form, setForm] = useState({
    id: supplier.id,
    supplier_name: supplier.supplier_name || '',
    supplier_type: supplier.supplier_type || 'Manufacturer',
    contact_person: supplier.contact_person || '',
    email: supplier.email || '',
    phone: supplier.phone || '',
    address: supplier.address || '',
  })


  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    })
  }


  function handleSubmit(e) {
    e.preventDefault()

    if (!form.supplier_name || !form.supplier_type) {
      return
    }

    onSubmit(form)
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Edit Supplier
          </h2>

          <p className="text-sm text-gray-500">
            Update supplier information.
          </p>
        </div>


        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">

            {/* Supplier Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Supplier Name
              </label>

              <input
                type="text"
                name="supplier_name"
                value={form.supplier_name}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Supplier Type */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Supplier Type
              </label>

              <select
                name="supplier_type"
                value={form.supplier_type}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              >
                <option value="Manufacturer">
                  Manufacturer
                </option>

                <option value="Distributor">
                  Distributor
                </option>

                <option value="Supermarket">
                  Supermarket
                </option>
              </select>
            </div>


            {/* Contact Person */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Person
              </label>

              <input
                type="text"
                name="contact_person"
                value={form.contact_person}
                onChange={handleChange}
                placeholder="Enter contact person's name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
              />
            </div>


            {/* Phone */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Phone
              </label>

              <input
                type="text"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="Enter phone number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
                placeholder="Enter supplier address"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
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
// IMPORT SUPPLIER MODAL
// =============================================
function ImportSuppliersModal({ onClose, onSubmit }) {

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState([])
  const [errors, setErrors] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)


  // =============================================
  // HANDLE FILE
  // =============================================
  async function handleFileChange(e) {

    const selectedFile = e.target.files?.[0]

    if (!selectedFile) {
      return
    }

    setFile(selectedFile)
    setPreview([])
    setErrors([])

    try {
      const XLSX = await import('xlsx')

      const buffer = await selectedFile.arrayBuffer()

      const workbook = XLSX.read(buffer, {
        type: 'array',
      })

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

      const rows = XLSX.utils.sheet_to_json(firstSheet, {
        defval: '',
      })

      const validSuppliers = []
      const importErrors = []

      rows.forEach((row, index) => {

        const rowNumber = index + 2

        const supplierName =
          String(
            row.supplier_name ||
            row.Supplier_Name ||
            row['Supplier Name'] ||
            ''
          ).trim()

        const supplierType =
          String(
            row.supplier_type ||
            row.Supplier_Type ||
            row['Supplier Type'] ||
            ''
          ).trim()

        const contactPerson =
          String(
            row.contact_person ||
            row.Contact_Person ||
            row['Contact Person'] ||
            ''
          ).trim()

        const email =
          String(
            row.email ||
            row.Email ||
            ''
          ).trim()

        const phone =
          String(
            row.phone ||
            row.Phone ||
            ''
          ).trim()

        const address =
          String(
            row.address ||
            row.Address ||
            ''
          ).trim()


        // Skip completely empty rows
        if (!supplierName && !supplierType && !contactPerson && !email && !phone && !address) {
          return
        }


        // Required field validation
        if (!supplierName) {
          importErrors.push(
            `Row ${rowNumber}: Supplier name is required.`
          )

          return
        }


        if (!supplierType) {
          importErrors.push(
            `Row ${rowNumber}: Supplier type is required.`
          )

          return
        }


        // Supplier type validation
        const allowedTypes = [
          'Manufacturer',
          'Distributor',
          'Supermarket',
        ]

        if (!allowedTypes.includes(supplierType)) {

          importErrors.push(
            `Row ${rowNumber}: Invalid supplier type "${supplierType}".`
          )

          return
        }


        validSuppliers.push({
          supplier_name: supplierName,
          supplier_type: supplierType,
          contact_person: contactPerson || null,
          email: email || null,
          phone: phone || null,
          address: address || null,
        })

      })


      setPreview(validSuppliers)
      setErrors(importErrors)

    }
    
    catch (error) {
      console.error(error)
      setFile(null)
      setErrors([
        'Unable to read the spreadsheet. Please make sure the file is a valid CSV or Excel file.',
      ])
    }
  }


  // =============================================
  // IMPORT
  // =============================================
  async function handleImport() {
    if (preview.length === 0) {
      return
    }

    setIsProcessing(true)

    try {
      await onSubmit(preview)
    } 
    
    finally {
      setIsProcessing(false)
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            Import Suppliers
          </h2>

          <p className="text-sm text-gray-500">
            Bulk-add suppliers from a spreadsheet.
          </p>
        </div>


        {/* Content */}
        <div className="space-y-5 p-6">

          {/* Spreadsheet format */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-800">
              Spreadsheet format
            </p>

            <p className="mt-1 text-xs text-blue-700">
              Required columns:
              <span className="font-medium">
                {' '}supplier_name, supplier_type
              </span>
            </p>

            <p className="mt-1 text-xs text-blue-700">
              Optional columns:
              <span className="font-medium">
                {' '}contact_person, email, phone, address
              </span>
            </p>
          </div>


          {/* File input */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Spreadsheet
            </label>

            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full rounded-lg border border-gray-300 bg-white text-sm text-gray-700 file:mr-4 file:border-0 file:bg-[#F4F8F5] file:px-4 file:py-2 file:font-medium file:text-[#1F3A2C] hover:file:bg-[#E8F1EB]"
            />
          </div>


          {/* Selected file */}
          {file && (
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-sm font-medium text-gray-800">
                {file.name}
              </p>

              <p className="text-xs text-gray-500">
                {preview.length} valid supplier
                {preview.length !== 1 ? 's' : ''} found
              </p>
            </div>
          )}


          {/* Validation errors */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="mb-2 text-sm font-semibold text-red-800">
                Import warnings
              </p>

              <div className="max-h-32 overflow-y-auto">
                {errors.map((error, index) => (
                  <p key={index} className="text-xs text-red-700">
                    {error}
                  </p>
                ))}
              </div>
            </div>
          )}


          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-700">
                Preview
              </p>

              <div className="max-h-60 overflow-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">

                  <thead className="sticky top-0 bg-[#F4F8F5]">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                        Supplier
                      </th>

                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                        Type
                      </th>

                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                        Contact
                      </th>

                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                        Email
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {preview.map((supplier, index) => (
                      <tr key={index} className="border-t border-gray-200">
                        <td className="px-4 py-2">
                          {supplier.supplier_name}
                        </td>

                        <td className="px-4 py-2">
                          {supplier.supplier_type}
                        </td>

                        <td className="px-4 py-2">
                          {supplier.contact_person || '-'}
                        </td>

                        <td className="px-4 py-2">
                          {supplier.email || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                </table>
              </div>
            </div>
          )}


          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleImport}
              disabled={preview.length === 0 || isProcessing}
              className="rounded-lg bg-[#1F3A2C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2D5A42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isProcessing
                ? 'Importing...'
                : `Import ${preview.length} Supplier${preview.length !== 1 ? 's' : ''}`}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}