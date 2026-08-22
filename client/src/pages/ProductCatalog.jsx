'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'


export default function ProductCatalogPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [availability, setAvailability] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [manufacturers, setManufacturers] = useState([])


  // =============================================
  // LOAD PRODUCTS
  // =============================================
  async function loadProducts() {
    let query = supabase
      .from('products')
      .select(`
        id,
        product_name,
        sku,
        unit,
        brand,
        category,
        availability,
        supplier_id,
        suppliers (
          supplier_name,
          supplier_type
        )
      `)
      .order('product_name')

    if (search) {
      query = query.ilike('product_name', `%${search}%`)
    }

    if (category) {
      query = query.eq('category', category)
    }

    if (brand) {
      query = query.eq('brand', brand)
    }

    if (availability) {
      query = query.eq('availability', availability)
    }

    const { data, error } = await query

    if (error) {
      toast.error(error.message)
      return
    }

    setProducts(data)
  }


  // =============================================
  // LOAD MANUFACTURERS
  // =============================================
  async function loadManufacturers() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, supplier_name')
      .eq('supplier_type', 'Manufacturer')
      .order('supplier_name')

    if (error) {
      toast.error(error.message)
      return
    }

    setManufacturers(data || [])
  }


  // =============================================
  // DELETE PRODUCT
  // =============================================
  async function handleDeleteProduct(product) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${product.product_name}"?`
    )

    if (!confirmed) {
      return
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', product.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadProducts()

    toast.success('Product deleted successfully.')
  }


  // =============================================
  // UPDATE PRODUCT
  // =============================================
  async function handleUpdateProduct(updatedProduct) {
    const { error } = await supabase
      .from('products')
      .update({
        product_name: updatedProduct.product_name,
        sku: updatedProduct.sku,
        unit: updatedProduct.unit,
        brand: updatedProduct.brand,
        category: updatedProduct.category,
        availability: updatedProduct.availability,
        supplier_id: updatedProduct.supplier_id || null,
      })
      .eq('id', updatedProduct.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await loadProducts()

    setShowEditModal(false)
    setEditingProduct(null)

    toast.success('Product updated successfully.')
  }


  // =============================================
  // OPEN EDIT MODAL
  // =============================================
  async function handleEditProduct(product) {
    setEditingProduct(product)
    setShowEditModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadProducts()
  }, [search, category, brand, availability])

  useEffect(() => {
    loadManufacturers()
  }, [])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Product Catalog
        </h1>

        <p className="text-gray-500">
          Browse available export products.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 grid grid-cols-4 gap-4">

        <input
          type="text"
          placeholder="Search product..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 focus:border-[#2D5A42] focus:outline-none bg-white"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 bg-white"
        >
          <option value="">All Categories</option>
          <option value="Biscuits">Biscuits</option>
          <option value="Snacks">Snacks</option>
          <option value="Coffee">Coffee</option>
        </select>

        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 bg-white"
        >
          <option value="">All Brands</option>
          <option value="Monde">Monde</option>
          <option value="URC">URC</option>
          <option value="Nestle">Nestle</option>
        </select>

        <select
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 bg-white"
        >
          <option value="">All</option>
          <option value="Available">Available</option>
          <option value="Unavailable">Unavailable</option>
        </select>

      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

        <table className="min-w-full">

          <thead className="bg-[#F4F8F5]">
            <tr>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                SKU
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Product
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Manufacturer
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Category
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Unit
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Availability
              </th>

              {profile?.role === 'admin' && (
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Actions
                </th>
              )}
            </tr>
          </thead>

          <tbody>

            {products.length > 0 ? (
              products.map((product) => (
                <tr
                  key={product.id}
                  className="border-t border-gray-200 text-sm hover:bg-gray-50"
                >

                  <td className="px-5 py-3">
                    {product.sku}
                  </td>

                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-800">
                      {product.product_name}
                    </p>

                    {product.brand && (
                      <p className="text-sm text-gray-500">
                        {product.brand}
                      </p>
                    )}
                  </td>

                  <td className="px-5 py-3 text-gray-700">
                    {product.suppliers?.supplier_type === 'Manufacturer' ? product.suppliers.supplier_name : '-'}
                  </td>

                  <td className="px-5 py-3">
                    {product.category}
                  </td>

                  <td className="px-5 py-3">
                    {product.unit}
                  </td>

                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        product.availability === 'Available'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {product.availability}
                    </span>
                  </td>

                  {profile?.role === 'admin' && (
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-start gap-2"> 
                        <IconButton icon={faPen} title="Edit Product" color="amber" disabled={false} onClick={() => handleEditProduct(product)}/>
                        <IconButton icon={faTrash} title="Delete Product" color="red" disabled={false} onClick={() => handleDeleteProduct(product)}/>

                      </div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={profile?.role === 'admin' ? 7 : 6}
                  className="py-10 text-center text-sm text-gray-500"
                >
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


      {showEditModal && editingProduct && (
        <EditProductModal
          product={editingProduct}
          manufacturers={manufacturers}
          onClose={() => {
            setShowEditModal(false)
            setEditingProduct(null)
          }}
          onSubmit={handleUpdateProduct}
        />
      )}

    </div>
  )
}



// =============================================
// EDIT PRODUCT MODAL
// =============================================
function EditProductModal({ product, manufacturers, onClose, onSubmit }) {
  const [form, setForm] = useState({
    id: product.id,
    product_name: product.product_name || '',
    sku: product.sku || '',
    unit: product.unit || '',
    brand: product.brand || '',
    category: product.category || '',
    availability: product.availability || 'Available',
    supplier_id: product.supplier_id || '',
  })

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    })
  }

  function handleSubmit(e) {
    e.preventDefault()

    if (
      !form.product_name ||
      !form.sku ||
      !form.unit ||
      !form.brand ||
      !form.category
    ) {
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
              Edit Product
            </h2>

            <p className="text-sm text-gray-500">
              Update product information.
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
        <form
          onSubmit={handleSubmit}
          className="space-y-6 p-6"
        >

          <div className="grid grid-cols-2 gap-4">

            {/* Product Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Product Name
              </label>

              <input
                type="text"
                name="product_name"
                value={form.product_name}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* SKU */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                SKU
              </label>

              <input
                type="text"
                name="sku"
                value={form.sku}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Brand */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Brand
              </label>

              <input
                type="text"
                name="brand"
                value={form.brand}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Unit */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Unit
              </label>

              <input
                type="text"
                name="unit"
                value={form.unit}
                onChange={handleChange}
                placeholder="e.g. Box, Piece, Case"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>


            {/* Category */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Category
              </label>

              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              >
                <option value="">
                  Select category
                </option>

                <option value="Biscuits">
                  Biscuits
                </option>

                <option value="Snacks">
                  Snacks
                </option>

                <option value="Coffee">
                  Coffee
                </option>
              </select>
            </div>


            {/* Availability */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Availability
              </label>

              <select
                name="availability"
                value={form.availability}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              >
                <option value="Available">
                  Available
                </option>

                <option value="Unavailable">
                  Unavailable
                </option>
              </select>
            </div>


            {/* Manufacturer */}
            <div className="col-span-2">

              <label className="mb-1 block text-sm font-medium text-gray-700">
                Manufacturer
              </label>

              <select
                name="supplier_id"
                value={form.supplier_id}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
              >

                <option value="">
                  Select manufacturer
                </option>

                {manufacturers.map((manufacturer) => (
                  <option
                    key={manufacturer.id}
                    value={manufacturer.id}
                  >
                    {manufacturer.supplier_name}
                  </option>
                ))}

              </select>

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