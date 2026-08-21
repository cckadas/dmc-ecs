'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { faPen, faTrash } from '@fortawesome/free-solid-svg-icons'
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
        availability
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
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    loadProducts()
  }, [search, category, brand, availability])


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
                Brand
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

                  <td className="px-5 py-3 font-medium text-gray-800">
                    {product.product_name}
                  </td>

                  <td className="px-5 py-3">
                    {product.brand}
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
                        <IconButton icon={faPen} title="Edit Product" color="amber" disabled={false} onClick={() => {}}/>
                        <IconButton icon={faTrash} title="Delete Product" color="red" disabled={false} onClick={() => {}}/>

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
    </div>
  )
}