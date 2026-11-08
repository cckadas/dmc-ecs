import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faFileImport, faFloppyDisk, faPen, faXmark } from '@fortawesome/free-solid-svg-icons'

import IconButton from '../components/IconButton'
import { BOM, parseCsv, toCsv } from '../utils/csv'
import { localDateString } from '../utils/dates'
import { saveSupplierPrices, pricingErrorMessage } from '../services/pricingService'
import TableScroll from '../components/TableScroll'


// Header names accepted in a supplier's price-list file (case-insensitive).
const SKU_HEADERS = ['sku', 'product code', 'item code']
const PRICE_HEADERS = ['unit price', 'price', 'unit cost', 'cost']
const MOQ_HEADERS = ['moq', 'min order qty', 'min order quantity', 'minimum order quantity']

// Preview statuses that will be imported; everything else is skipped.
const READY_STATUSES = ['New', 'Price change']

const findColumn = (header, names) =>
  header.findIndex((cell) => names.includes(cell.trim().toLowerCase()))

const formatMoney = (value) =>
  `₱ ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const th = 'px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600'


export default function SupplierPriceLists() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [products, setProducts] = useState([])
  const [currentPrices, setCurrentPrices] = useState({})
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [setupError, setSetupError] = useState('')

  // Editing one price — the main way prices are kept up to date.
  const [editingProductId, setEditingProductId] = useState(null)
  const [editPrice, setEditPrice] = useState('')
  const [editMoq, setEditMoq] = useState('')
  const [savingPrice, setSavingPrice] = useState(false)

  // Importing a whole file — optional, for long price lists.
  const [showImport, setShowImport] = useState(false)
  const [preview, setPreview] = useState([])
  const [fileName, setFileName] = useState('')
  const [fileInputKey, setFileInputKey] = useState(0)
  const [importing, setImporting] = useState(false)



  // =============================================
  // LOAD SUPPLIERS
  // =============================================
  async function loadSuppliers() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, supplier_name')
      .order('supplier_name')

    if (error) {
      toast.error(error.message)
      return
    }

    setSuppliers(data || [])
  }


  // =============================================
  // LOAD ONE SUPPLIER'S PRODUCTS AND CURRENT PRICES
  // =============================================
  async function loadCatalog(id) {
    setLoadingCatalog(true)
    setSetupError('')

    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('id, product_name, sku, unit')
      .eq('supplier_id', id)
      .order('product_name')

    if (productError) {
      toast.error(productError.message)
      setLoadingCatalog(false)
      return
    }

    setProducts(productData || [])

    const { data: priceData, error: priceError } = await supabase
      .from('supplier_price_list')
      .select('product_id, unit_price, min_order_qty, effective_from')
      .eq('supplier_id', id)
      .is('effective_to', null)

    if (priceError) {
      setSetupError(pricingErrorMessage(priceError))
      setCurrentPrices({})
    } else {
      setCurrentPrices(
        Object.fromEntries((priceData || []).map((row) => [row.product_id, row]))
      )
    }

    setLoadingCatalog(false)
  }


  function handleSupplierChange(id) {
    setSupplierId(id)
    setEditingProductId(null)
    setPreview([])
    setFileName('')
    setFileInputKey((key) => key + 1)

    if (id) {
      loadCatalog(id)
    } else {
      setProducts([])
      setCurrentPrices({})
    }
  }


  // =============================================
  // EDIT ONE PRICE
  // =============================================
  function startEdit(product) {
    const current = currentPrices[product.id]

    setEditingProductId(product.id)
    setEditPrice(current ? String(current.unit_price) : '')
    setEditMoq(current?.min_order_qty ? String(current.min_order_qty) : '')
  }


  async function savePrice(product) {
    const price = Number(String(editPrice).replace(/[₱,\s]/g, ''))
    const moq = editMoq.trim() === '' ? null : Number(editMoq)

    if (!(price > 0)) {
      toast.error('Enter a price above ₱0.')
      return
    }

    if (moq !== null && !(Number.isInteger(moq) && moq > 0)) {
      toast.error('MOQ must be a whole number above 0, or left blank.')
      return
    }

    setSavingPrice(true)

    try {
      // Same save path as a file import: the old price is kept as history,
      // so orders already made at it are unaffected.
      const result = await saveSupplierPrices({
        supplierId,
        effectiveFrom: localDateString(),
        rows: [{ product_id: product.id, unit_price: price, min_order_qty: moq }],
      })

      toast.success(
        result.unchanged > 0
          ? `No change — ${product.product_name} already has that price.`
          : `Price for ${product.product_name} saved.`
      )

      setEditingProductId(null)
      await loadCatalog(supplierId)
    } catch (error) {
      console.error('Saving price failed:', error)
      toast.error(pricingErrorMessage(error))
    } finally {
      setSavingPrice(false)
    }
  }


  // =============================================
  // DOWNLOAD A TEMPLATE
  //
  // Pre-filled with this supplier's SKUs and current prices, so updating a
  // price list means editing numbers rather than retyping SKUs.
  // =============================================
  function downloadTemplate() {
    const supplier = suppliers.find((s) => s.id === supplierId)

    const rows = [
      ['SKU', 'Product', 'Unit', 'Unit Price', 'MOQ'],
      ...products.map((product) => [
        product.sku,
        product.product_name,
        product.unit || '',
        currentPrices[product.id]?.unit_price ?? '',
        currentPrices[product.id]?.min_order_qty ?? '',
      ]),
    ]

    // The BOM makes Excel read names like "Nestlé" correctly.
    const blob = new Blob([BOM + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `price-list-${(supplier?.supplier_name || 'supplier').replace(/[^\w-]+/g, '-').toLowerCase()}.csv`
    link.click()

    URL.revokeObjectURL(url)
  }


  // =============================================
  // READ A PRICE-LIST FILE (in the browser — never uploaded)
  // =============================================
  async function handleFile(file) {
    if (!file) return

    setPreview([])
    setFileName(file.name)

    const rows = parseCsv(await file.text())

    if (rows.length < 2) {
      toast.error('The file has no price rows.')
      return
    }

    const header = rows[0]
    const skuColumn = findColumn(header, SKU_HEADERS)
    const priceColumn = findColumn(header, PRICE_HEADERS)
    const moqColumn = findColumn(header, MOQ_HEADERS)

    if (skuColumn < 0 || priceColumn < 0) {
      toast.error('The file needs a "SKU" column and a "Unit Price" column.')
      return
    }

    // All products, so a SKU that belongs to another supplier is reported as
    // such rather than as unknown.
    const { data: allProducts, error } = await supabase
      .from('products')
      .select('id, sku, product_name, supplier_id')

    if (error) {
      toast.error(error.message)
      return
    }

    const productsBySku = Object.fromEntries(
      (allProducts || []).map((product) => [product.sku.trim().toLowerCase(), product])
    )
    const supplierNames = Object.fromEntries(
      suppliers.map((supplier) => [supplier.id, supplier.supplier_name])
    )
    const seen = new Set()

    const lines = rows.slice(1).map((cells, index) => {
      const sku = (cells[skuColumn] || '').trim()
      const rawPrice = (cells[priceColumn] || '').trim()
      const rawMoq = moqColumn >= 0 ? (cells[moqColumn] || '').trim() : ''
      const price = Number(rawPrice.replace(/[₱,\s]|php/gi, ''))
      const moq = rawMoq === '' ? null : Number(rawMoq.replace(/,/g, ''))
      const product = productsBySku[sku.toLowerCase()]
      const line = { row: index + 2, sku, price, moq, product }

      if (!sku) return { ...line, status: 'Missing SKU', detail: '' }
      if (!product) return { ...line, status: 'Unknown SKU', detail: 'Not in the product catalog' }

      if (product.supplier_id !== supplierId) {
        return { ...line, status: 'Other supplier', detail: `Supplied by ${supplierNames[product.supplier_id] || 'another supplier'}` }
      }

      if (!(price > 0)) return { ...line, status: 'Invalid price', detail: `"${rawPrice}"` }

      if (moq !== null && !(Number.isInteger(moq) && moq > 0)) {
        return { ...line, status: 'Invalid MOQ', detail: `"${rawMoq}"` }
      }

      if (seen.has(product.id)) return { ...line, status: 'Duplicate', detail: 'SKU appears earlier in the file' }
      seen.add(product.id)

      const current = currentPrices[product.id]

      if (!current) return { ...line, status: 'New', detail: '' }

      if (Number(current.unit_price) === price && (current.min_order_qty ?? null) === moq) {
        return { ...line, status: 'Unchanged', detail: '' }
      }

      return {
        ...line,
        status: 'Price change',
        detail: `was ${formatMoney(current.unit_price)}${current.min_order_qty ? `, MOQ ${current.min_order_qty}` : ''}`,
      }
    })

    setPreview(lines)
  }


  // =============================================
  // IMPORT (one transaction — all rows or none)
  // =============================================
  async function importReadyRows() {
    const ready = preview.filter((line) => READY_STATUSES.includes(line.status))

    if (ready.length === 0) {
      toast.info('Nothing to import — no new or changed prices in this file.')
      return
    }

    const confirmed = window.confirm(
      `Save ${ready.length} price${ready.length === 1 ? '' : 's'}? Previous prices are kept as history, so past orders are not affected.`
    )

    if (!confirmed) return

    setImporting(true)

    try {
      const result = await saveSupplierPrices({
        supplierId,
        effectiveFrom: localDateString(),
        rows: ready.map((line) => ({
          product_id: line.product.id,
          unit_price: line.price,
          min_order_qty: line.moq,
        })),
      })

      const saved = result.added + result.updated
      toast.success(`Price list imported: ${saved} price${saved === 1 ? '' : 's'} saved.`)

      setPreview([])
      setFileName('')
      setFileInputKey((key) => key + 1)
      await loadCatalog(supplierId)
    } catch (error) {
      console.error('Price list import failed:', error)
      toast.error(pricingErrorMessage(error))
    } finally {
      setImporting(false)
    }
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadSuppliers()
    }
  }, [profile])


  const readyCount = preview.filter((line) => READY_STATUSES.includes(line.status)).length
  const unchangedCount = preview.filter((line) => line.status === 'Unchanged').length
  const skippedCount = preview.length - readyCount - unchangedCount


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Supplier Price Lists
        </h1>

        <p className="mt-1 text-gray-500">
          Each supplier's current price for each of its products. These fill in purchase-order prices automatically.
        </p>
      </div>


      {/* Supplier */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Supplier
        </label>

        <select
          value={supplierId}
          onChange={(e) => handleSupplierChange(e.target.value)}
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
        >
          <option value="">Select a supplier</option>

          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.supplier_name}
            </option>
          ))}
        </select>
      </div>


      {setupError && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{setupError}</p>
        </div>
      )}


      {/* Current prices — the main way to keep them up to date */}
      {supplierId && (
        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#1F3A2C]">
                Current prices
              </h2>

              <p className="text-sm text-gray-500">
                Use the pencil to change a price. The old price is kept as history, so orders already made at it don't change. The MOQ is shown to customers, who can't request less than it.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowImport(!showImport)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <FontAwesomeIcon icon={faFileImport} />
              {showImport ? 'Hide file import' : 'Import from a file (optional)'}
            </button>
          </div>

          <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full">
              <thead className="bg-[#F4F8F5]">
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>SKU</th>
                  <th className={th}>Unit Price</th>
                  <th className={th}>MOQ</th>
                  <th className={th}>Effective From</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>

              <tbody>
                {loadingCatalog ? (
                  <tr>
                    <td colSpan="6" className="px-5 py-8 text-center text-sm text-gray-500">Loading...</td>
                  </tr>
                ) : products.length > 0 ? (
                  products.map((product) => {
                    const current = currentPrices[product.id]
                    const effectiveFrom = current
                      ? new Date(`${current.effective_from}T00:00:00`).toLocaleDateString()
                      : '-'

                    if (editingProductId === product.id) {
                      const onKeyDown = (e) => {
                        if (e.key === 'Enter') savePrice(product)
                        if (e.key === 'Escape') setEditingProductId(null)
                      }

                      return (
                        <tr key={product.id} className="border-t border-gray-200 bg-[#F4F8F5] text-sm">
                          <td className="px-5 py-3 font-medium text-gray-800">{product.product_name}</td>
                          <td className="px-5 py-3">{product.sku}</td>

                          <td className="px-5 py-3">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₱</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                onKeyDown={onKeyDown}
                                disabled={savingPrice}
                                autoFocus
                                placeholder="0.00"
                                className="w-32 rounded-md border border-gray-300 py-2 pl-7 pr-3 text-right text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                              />
                            </div>
                            {product.unit && <p className="mt-1 text-xs text-gray-500">per {product.unit}</p>}
                          </td>

                          <td className="px-5 py-3">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={editMoq}
                              onChange={(e) => setEditMoq(e.target.value)}
                              onKeyDown={onKeyDown}
                              disabled={savingPrice}
                              placeholder="None"
                              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-right text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                            />
                          </td>

                          <td className="px-5 py-3 text-gray-500">{effectiveFrom}</td>

                          <td className="px-5 py-3">
                            <div className="flex gap-2">
                              <IconButton icon={faFloppyDisk} title="Save Price" color="green" disabled={savingPrice} onClick={() => savePrice(product)} />
                              <IconButton icon={faXmark} title="Cancel" color="red" disabled={savingPrice} onClick={() => setEditingProductId(null)} />
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={product.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-800">{product.product_name}</td>
                        <td className="px-5 py-3">{product.sku}</td>
                        <td className="px-5 py-3">
                          {current
                            ? `${formatMoney(current.unit_price)}${product.unit ? ` / ${product.unit}` : ''}`
                            : <span className="text-amber-700">No price on file</span>}
                        </td>
                        <td className="px-5 py-3">{current?.min_order_qty ?? '-'}</td>
                        <td className="px-5 py-3">{effectiveFrom}</td>
                        <td className="px-5 py-3">
                          <IconButton
                            icon={faPen}
                            title={current ? 'Edit Price' : 'Set Price'}
                            color="amber"
                            disabled={editingProductId !== null}
                            onClick={() => startEdit(product)}
                          />
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan="6" className="px-5 py-8 text-center text-sm text-gray-500">
                      This supplier has no products in the catalog yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}


      {/* Optional — import a whole price list from a file */}
      {supplierId && showImport && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800">
            Import a price list from a file
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Optional — handy when a supplier sends a long price list. Download the template (it lists this supplier's products), fill in the <b>Unit Price</b> column and, if you like, <b>MOQ</b>, then save it as <b>CSV UTF-8</b> and choose it below.
            The file is read in your browser and never uploaded.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={products.length === 0}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faDownload} />
              Download template
            </button>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633]">
              <FontAwesomeIcon icon={faFileImport} />
              Choose CSV file
              <input
                key={fileInputKey}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>

            {fileName && (
              <span className="text-sm text-gray-500">{fileName}</span>
            )}
          </div>


          {/* Review before saving */}
          {preview.length > 0 && (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Review before saving
                  </h3>

                  <p className="text-sm text-gray-500">
                    {readyCount} to save · {unchangedCount} unchanged · {skippedCount} skipped
                  </p>
                </div>

                <button
                  type="button"
                  onClick={importReadyRows}
                  disabled={importing || readyCount === 0}
                  className="flex items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                  {importing ? 'Saving...' : `Save ${readyCount} price${readyCount === 1 ? '' : 's'}`}
                </button>
              </div>

              <TableScroll className="rounded-lg border border-gray-200">
                <table className="min-w-full">
                  <thead className="bg-[#F4F8F5]">
                    <tr>
                      <th className={th}>Row</th>
                      <th className={th}>SKU</th>
                      <th className={th}>Product</th>
                      <th className={th}>Unit Price</th>
                      <th className={th}>MOQ</th>
                      <th className={th}>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {preview.map((line) => {
                      const ready = READY_STATUSES.includes(line.status)
                      const unchanged = line.status === 'Unchanged'

                      return (
                        <tr key={line.row} className="border-t border-gray-200 text-sm">
                          <td className="px-5 py-3 text-gray-500">{line.row}</td>
                          <td className="px-5 py-3 font-medium text-gray-800">{line.sku || '-'}</td>
                          <td className="px-5 py-3">{line.product?.product_name || '-'}</td>
                          <td className="px-5 py-3">{line.price > 0 ? formatMoney(line.price) : '-'}</td>
                          <td className="px-5 py-3">{line.moq ?? '-'}</td>
                          <td className="px-5 py-3">
                            <span className={`font-medium ${ready ? 'text-green-700' : unchanged ? 'text-gray-500' : 'text-red-700'}`}>
                              {line.status}
                            </span>

                            {line.detail && (
                              <span className="ml-2 text-xs text-gray-500">{line.detail}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
