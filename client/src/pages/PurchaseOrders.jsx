'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { sendPurchaseOrderEmails } from '../services/emailService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faEye,
  faPlus,
  faXmark,
  faFileInvoice
} from '@fortawesome/free-solid-svg-icons'

import StatusBadge from '../components/StatusBadge'
import IconButton from '../components/IconButton'


export default function PurchaseOrdersPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [customerOrders, setCustomerOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [selectedPO, setSelectedPO] = useState(null)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingCustomerOrders, setLoadingCustomerOrders] = useState(false)
  const [loadingSuppliers, setLoadingSuppliers] = useState(false)
  const [creatingPO, setCreatingPO] = useState(false)


  // =====================================================
  // LOAD PURCHASE ORDERS
  // =====================================================
  async function loadPurchaseOrders() {
    setLoading(true)

    const {data, error} = await supabase
      .from('purchase_orders')
      .select(`
        id,
        customer_order_id,
        po_number,
        status,
        expected_delivery_date,
        created_at,
        updated_at,

        purchase_order_items (
          id,
          product_id,
          supplier_id,
          ordered_quantity,
          received_quantity,
          unit_price,
          status,
          created_at,
          updated_at,

          products (
            id,
            product_name,
            brand,
            supplier_id
          ),

          suppliers (
            id,
            supplier_name,
            contact_person,
            email,
            phone,
            supplier_type
          )
        ),

        customer_orders (
          id,
          order_number,
          customer_id,
          quotation_number,
          total_amount,
          status
        )
      `)
      .order('created_at', {
        ascending: false
      })


    if (error) {
      console.error('Failed to load purchase orders:', error)
      toast.error('Failed to load purchase orders.')
      setLoading(false)
      return
    }


    // -------------------------------------------------
    // GET CUSTOMER IDS
    // -------------------------------------------------
    const customerIds = [
      ...new Set(
        (data || [])
          .map(
            (po) =>
              po.customer_orders?.customer_id
          )
          .filter(Boolean)
      )
    ]


    // -------------------------------------------------
    // LOAD PROFILES
    // -------------------------------------------------
    let profilesMap = {}

    if (customerIds.length > 0) {
      const {data: profiles, error: profileError} = await supabase
        .from('profiles')
        .select(`
          id,
          name,
          email,
          company,
          address,
          country
        `)
        .in('id', customerIds)

      if (profileError) {
        console.error('Failed to load profiles:', profileError)
        toast.error('Failed to load customer information.')
        setLoading(false)
        return
      }

      profilesMap = (profiles || []).reduce(
        (map, customer) => {
          map[customer.id] = customer
          return map
        },
        {}
      )
    }


    // -------------------------------------------------
    // ATTACH CUSTOMER PROFILE
    // -------------------------------------------------
    const formattedPurchaseOrders =
      (data || []).map((po) => {

        const customerId = po.customer_orders?.customer_id

        return {
          ...po,
          customer_orders:
            po.customer_orders
              ? {...po.customer_orders, profile: profilesMap[customerId] || null}
              : null
        }
      })

    setPurchaseOrders(formattedPurchaseOrders)
    setLoading(false)
  }


  // =====================================================
  // LOAD CUSTOMER ORDERS FOR ADD PO
  // =====================================================
  async function loadCustomerOrders() {
    setLoadingCustomerOrders(true)

    const {data, error} = await supabase
      .from('customer_orders')
      .select(`
        id,
        order_number,
        customer_id,
        quotation_number,
        total_amount,
        status,
        created_at,

        customer_order_items (
          id,
          product_id,
          quantity,
          unit_price,
          subtotal,

          products (
            id,
            product_name,
            brand,
            supplier_id
          )
        )
      `)
      .eq('status', 'payment verified')
      .order('created_at', {
        ascending: false
      })


    if (error) {
      console.error('Failed to load customer orders:', error)
      toast.error('Failed to load customer orders.')
      setLoadingCustomerOrders(false)
      return
    }


    // -------------------------------------------------
    // GET CUSTOMER IDS
    // -------------------------------------------------
    const customerIds = [
      ...new Set(
        (data || [])
          .map((order) => order.customer_id)
          .filter(Boolean)
      )
    ]


    // -------------------------------------------------
    // LOAD PROFILES
    // -------------------------------------------------
    let profilesMap = {}

    if (customerIds.length > 0) {
      const {data: profiles, error: profileError} = await supabase
        .from('profiles')
        .select(`
          id,
          name,
          email,
          company,
          address,
          country
        `)
        .in('id', customerIds)


      if (profileError) {
        console.error('Failed to load profiles:', profileError)
        toast.error('Failed to load customer information.')
        setLoadingCustomerOrders(false)
        return
      }

      profilesMap =
        (profiles || []).reduce(
          (map, customer) => {
            map[customer.id] = customer
            return map
          },
          {}
        )
    }


    // =================================================
    // ATTACH CUSTOMER PROFILE
    // =================================================
    const formattedOrders =
      (data || []).map((order) => {

        return {
          ...order,
          customer:
            profilesMap[
              order.customer_id
            ] || null
        }
      })


    setCustomerOrders(formattedOrders)
    setLoadingCustomerOrders(false)
  }


  // =====================================================
  // LOAD SUPPLIERS
  // =====================================================
  async function loadSuppliers() {

    setLoadingSuppliers(true)

    const {data, error} = await supabase
      .from('suppliers')
      .select(`
        id,
        supplier_name,
        contact_person,
        email,
        phone,
        address,
        supplier_type
      `)
      .order('supplier_name', {
        ascending: true
      })


    if (error) {
      console.error('Failed to load suppliers:', error)
      toast.error('Failed to load suppliers.')
      setLoadingSuppliers(false)
      return
    }

    setSuppliers(data || [])
    setLoadingSuppliers(false)
  }


  // =====================================================
  // OPEN ADD PO MODAL
  // =====================================================
  async function openAddModal() {
    setShowAddModal(true)

    await Promise.all([
      loadCustomerOrders(),
      loadSuppliers()
    ])
  }


  // =====================================================
  // OPEN VIEW PO
  // =====================================================
  function openViewModal(po) {
    setSelectedPO(po)
    setShowViewModal(true)
  }



  // =====================================================
  // CREATE PURCHASE ORDER
  // =====================================================
  async function createPurchaseOrder({expectedDeliveryDate, customerOrderId, items}) {

    if (!expectedDeliveryDate) {
      toast.error('Please set expected delivery date.')
      return
    }

    if (!customerOrderId) {
      toast.error('Please select a customer order.')
      return
    }

    if (!items || items.length === 0) {
      toast.error('Please add at least one product.')
      return
    }

    for (const item of items) {
      if (!item.supplier_id) {
        toast.error(`Please select a supplier for ${item.product_name}.`)
        return
      }


      if (!item.ordered_quantity || Number(item.ordered_quantity) <= 0) {
        toast.error(`Invalid quantity for ${item.product_name}.`)
        return
      }


      if (item.unit_price === '' || item.unit_price === null ||  Number(item.unit_price) < 0) {
        toast.error(`Please enter a valid purchase price for ${item.product_name}.`)
        return
      }
    }


    setCreatingPO(true)


    try {
      // -------------------------------------------------
      // CREATE PURCHASE ORDER NUMBER
      // -------------------------------------------------
      const now = new Date()
      const year = now.getFullYear()

      const { data: existingPO, error: existingPOError } = await supabase
        .from('purchase_orders')
        .select('po_number')
        .like('po_number', `PO-${year}-%`)

      if (existingPOError) {
        throw existingPOError
      }

      let nextNumber = 1

      if (existingPO && existingPO.length > 0) {
        const numbers = existingPO
          .map((po) => {
            const match = po.po_number?.match(/^PO-\d{4}-(\d+)$/)
            return match ? Number(match[1]) : 0
          })
          .filter((number) => number > 0)

        if (numbers.length > 0) {
          nextNumber = Math.max(...numbers) + 1
        }
      }

      const poNumber = `PO-${year}-${String(nextNumber).padStart(5, '0')}`


      // -------------------------------------------------
      // INSERT PURCHASE ORDER MAIN
      // -------------------------------------------------
      const {data: purchaseOrder, error: purchaseOrderError} = await supabase
        .from('purchase_orders')
        .insert({
          expected_delivery_date: expectedDeliveryDate,
          customer_order_id: customerOrderId,
          po_number: poNumber,
          status: 'pending'
        })
        .select()
        .single()

      if (purchaseOrderError) {
        throw purchaseOrderError
      }


      // -------------------------------------------------
      // PREPARE PURCHASE ORDER ITEMS
      // -------------------------------------------------
      const purchaseOrderItems =
        items.map((item) => ({
          purchase_order_id: purchaseOrder.id,
          product_id: item.product_id,
          supplier_id: item.supplier_id,
          ordered_quantity: Number(item.ordered_quantity),
          received_quantity: 0,
          unit_price: Number(item.unit_price),
          status: 'pending'
        }))


      // -------------------------------------------------
      // INSERT PURCHASE ORDER ITEMS
      // -------------------------------------------------
      const {error: itemsError} = await supabase
        .from('purchase_order_items')
        .insert(
          purchaseOrderItems
        )


      if (itemsError) {
        await supabase
          .from('purchase_orders')
          .delete()
          .eq('id', purchaseOrder.id)

        throw itemsError
      }


      // -------------------------------------------------
      // UPDATE CUSTOMER ORDER STATUS
      // -------------------------------------------------
      const {error: customerOrderError} = await supabase
        .from('customer_orders')
        .update({ status: 'procurement' })
        .eq('id', customerOrderId)


      if (customerOrderError) {
        throw customerOrderError
      }


      // -------------------------------------------------
      // SEND PURCHASE ORDER EMAILS
      // -------------------------------------------------

      await sendPurchaseOrderEmails(purchaseOrder.id)


      toast.success( `Purchase Order ${poNumber} created successfully.`)
      setShowAddModal(false)
      await loadPurchaseOrders()
    }
    
    catch (error) {
      console.error('Create purchase order error:', error)
      toast.error( error.message || 'Failed to create purchase order.')
    }
    
    finally {
      setCreatingPO(false)
    }
  }


  // =====================================================
  // GET AVAILABLE SUPPLIERS
  // =====================================================
  function getAvailableSuppliers(item) {

    console.log(item)
    console.log(suppliers)

    const primarySupplier = suppliers.find(
      (supplier) => supplier.id === item.product_supplier_id && supplier.supplier_type === 'Manufacturer'
    )

    console.log(primarySupplier)

    const otherSuppliers = suppliers
      .filter(
        (supplier) => supplier.supplier_type === 'Distributor' || supplier.supplier_type === 'Supermarket'
      )
      .sort((a, b) =>
        a.supplier_name.localeCompare(b.supplier_name)
      )

    return [
      ...(primarySupplier ? [primarySupplier] : []),
      ...otherSuppliers
    ]
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    if (profile?.id) {
      loadPurchaseOrders()
    }
  }, [profile?.id])


  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Purchase Orders
          </h1>

          <p className="text-gray-500">
            View and manage purchase orders.
          </p>
        </div>


        <button
          onClick={openAddModal}
          className="flex items-center gap-2 rounded-lg bg-[#1F3A2C] px-4 py-2.5 text-sm font-medium text-white shadow-sm  hover:bg-[#294D3A]"
        >

          <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5"/>
          Add Purchase Order
        </button>

      </div>


      {/* =================================================
          PURCHASE ORDERS TABLE
      ================================================= */}
      <div className=" overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">

            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                PO Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Customer Order
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Customer
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Suppliers
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Items
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Date
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Action
              </th>
            </tr>
          </thead>


          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="py-10 text-center text-sm text-gray-500">
                  Loading purchase orders...
                </td>
              </tr>
            ) : purchaseOrders.length > 0 ? (
              purchaseOrders.map((po) => {
                const items = po.purchase_order_items || []
                const suppliersMap = new Map()

                items.forEach((item) => {
                  if (item.suppliers) {
                    suppliersMap.set(
                      item.suppliers.id,
                      item.suppliers
                    )
                  }
                })

                const suppliers = Array.from(suppliersMap.values())

                return (
                  <tr key={po.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">

                    {/* PO NUMBER */}
                    <td className="px-5 py-4 font-semibold text-gray-800">
                      {po.po_number || '-'}
                    </td>


                    {/* CUSTOMER ORDER */}
                    <td className="px-5 py-4">
                      {po.customer_orders ?.order_number || '-'}
                    </td>


                    {/* CUSTOMER */}
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-medium text-gray-800">
                          {po.customer_orders ?.profile ?.name || '-'}
                        </p>


                        {po.customer_orders ?.profile?.company && (
                            <p className=" text-xs text-gray-500">
                              {po.customer_orders.profile.company}
                            </p>
                        )}
                      </div>
                    </td>


                    {/* SUPPLIERS */}
                    <td className="px-5 py-4">
                      {suppliers.length > 0 ? (
                        <div className="space-y-1">

                          {suppliers.map(
                            (supplier) => (
                              <div key={supplier.id} className="text-sm text-gray-700">
                                {supplier.supplier_name}
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">
                          -
                        </span>
                      )}
                    </td>


                    {/* ITEMS */}
                    <td className="px-5 py-4">
                      {items.length}
                    </td>


                    {/* STATUS */}
                    <td className="px-5 py-4">
                      <StatusBadge status={po.status}/>
                    </td>


                    {/* DATE */}
                    <td className="px-5 py-4">
                      {po.created_at ? new Date(po.created_at).toLocaleDateString() : '-'}
                    </td>


                    {/* ACTION */}
                    <td className="px-5 py-4">
                      <IconButton icon={faEye} title="View Purchase Order" color="blue" disabled={false} onClick={() => openViewModal(po)}/>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan="8" className="py-10 text-center text-sm text-gray-500">
                  No purchase orders found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>


      {showAddModal && (
        <AddPurchaseOrderModal
          customerOrders={customerOrders}
          suppliers={suppliers}
          loadingCustomerOrders={loadingCustomerOrders}
          loadingSuppliers={loadingSuppliers}
          getAvailableSuppliers={getAvailableSuppliers}
          creating={creatingPO}
          onCreate={createPurchaseOrder}
          onClose={() => {
            if (creatingPO) { return }
            setShowAddModal(false)
          }}
        />
      )}


      {showViewModal && selectedPO && (
        <PurchaseOrderModal
          purchaseOrder={selectedPO}
          onClose={() => {
            setShowViewModal(false)
            setSelectedPO(null)
          }}
        />
      )}
    </div>
  )
}

















// =====================================================
// ADD PURCHASE ORDER MODAL
// =====================================================
function AddPurchaseOrderModal({ customerOrders, getAvailableSuppliers, loadingCustomerOrders, loadingSuppliers, creating, onClose, onCreate }) {
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('')
  const [customerOrderId, setCustomerOrderId] = useState('')
  const [items, setItems] = useState([])

  // ---------------------------------------------------
  // SELECT CUSTOMER ORDER
  // ---------------------------------------------------
  function handleCustomerOrderChange(orderId) {
    setCustomerOrderId(orderId)

    const selectedOrder = customerOrders.find((order) => order.id === orderId)

    if (!selectedOrder) {
      setItems([])
      return
    }

    // ---------------------------------------------------
    // CONVERT CUSTOMER ORDER ITEMS INTO PURCHASE ORDER ITEMS
    // ---------------------------------------------------
  const purchaseItems = (selectedOrder.customer_order_items || [])
    .map((item) => ({
      customer_order_item_id: item.id,
      product_id: item.product_id,
      product_name: item.products?.product_name || 'Unknown Product',
      brand: item.products?.brand || '',
      ordered_quantity: Number(item.quantity || 0),

      // Supplier actually selected for the PO
      supplier_id: '',

      // Supplier assigned to the product
      product_supplier_id: item.products?.supplier_id || '',

      unit_price: ''
    }))

    setItems(purchaseItems)
  }


  // ===================================================
  // UPDATE SUPPLIER
  // ===================================================
  function updateSupplier(index, supplierId) {
    setItems((current) =>
      current.map(
        (item, itemIndex) =>
          itemIndex === index
            ? {...item, supplier_id: supplierId}
            : item
      )
    )
  }


  // ===================================================
  // UPDATE UNIT PRICE
  // ===================================================
  function updateUnitPrice(index, price) {
    setItems((current) =>
      current.map(
        (item, itemIndex) =>
          itemIndex === index
            ? {...item, unit_price: price}
            : item
      )
    )
  }


  // ===================================================
  // SELECTED CUSTOMER ORDER
  // ===================================================
  const selectedOrder =
    customerOrders.find(
      (order) => order.id === customerOrderId
    )


  // ===================================================
  // TOTAL
  // ===================================================
  const purchaseTotal =
    items.reduce(
      (total, item) => {
        return (total + (Number( item.ordered_quantity || 0) * Number(item.unit_price || 0)))
      },
      0
    )


  // ===================================================
  // SUBMIT
  // ===================================================
  function handleSubmit() {
    onCreate({
      customerOrderId,
      expectedDeliveryDate,
      items
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">


        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              Add Purchase Order
            </h2>

            <p className=" text-sm text-gray-500">
              Create a purchase order from a customer order.
            </p>
          </div>

          <button onClick={onClose} disabled={creating} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>



        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="flex-1 overflow-y-auto p-6">


          {/* =================================================
              CUSTOMER ORDER
          ================================================= */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Customer Order
            </label>

            <select
              value={customerOrderId}
              onChange={(e) => handleCustomerOrderChange(e.target.value)}
              disabled={creating || loadingCustomerOrders}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            >

              <option value="">
                {loadingCustomerOrders ? 'Loading customer orders...' : 'Select customer order'}
              </option>

              {customerOrders.map(
                (order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number} {' — '} {order.customer?.company || order.customer?.name || 'Unknown Customer'}
                  </option>
                )
              )}
            </select>
          </div>


          {/* =================================================
              SELECTED CUSTOMER INFORMATION
          ================================================= */}
          {selectedOrder && (
            <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-gray-500"> Customer Order </p>
                <p className="mt-1 font-medium text-gray-800"> {selectedOrder.order_number} </p>
              </div>

              <div>
                <p className="text-xs uppercase text-gray-500"> Customer </p>
                <p className="mt-1 font-medium text-gray-800"> {selectedOrder.customer?.name || '-'} </p>
              </div>

              <div>
                <p className="text-xs uppercase text-gray-500"> Company </p>
                <p className="mt-1 font-medium text-gray-800"> {selectedOrder.customer ?.company || '-'} </p>
              </div>

              <div>
                <p className=" text-xs uppercase text-gray-500"> Customer Order Total </p>
                <p className="mt-1 font-medium text-gray-800"> ₱ {Number(selectedOrder.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} </p>
              </div>
            </div>
          )}


          {/* =================================================
              EXPECTED DELIVERY DATE
          ================================================= */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Expected Delivery Date
            </label>

            <input
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              disabled={creating}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />

            <p className="mt-1 text-xs text-gray-500">
              Select the date when the supplier is expected to deliver the order.
            </p>
          </div>


          {/* =================================================
              INSTRUCTION
          ================================================= */}
          {selectedOrder && (
            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                Select a supplier and enter the supplier purchase price for each product.
              </p>
            </div>
          )}


          {/* =================================================
              ITEMS
          ================================================= */}
          {selectedOrder && (
            <div>

              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">
                  Purchase Order Items
                </h3>

                <span className="text-xs text-gray-500">
                  {items.length} item
                  {items.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <table className="min-w-full">

                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Product
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Quantity
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Supplier
                      </th>

                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                        Unit Price
                      </th>

                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                        Total
                      </th>
                    </tr>
                  </thead>


                  <tbody>
                    {items.length > 0 ? (
                      items.map(
                        (item, index) => {
                          const subtotal = Number(item.ordered_quantity || 0) * Number(item.unit_price || 0)

                          return (
                            <tr key={item.customer_order_item_id} className="border-t border-gray-200">

                              {/* PRODUCT */}
                              <td className="px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.product_name}
                                </p>

                                {item.brand && (
                                  <p className="text-xs text-gray-500">
                                    {item.brand}
                                  </p>
                                )}
                              </td>


                              {/* QUANTITY */}
                              <td className=" px-4 py-4">
                                <p className="font-medium text-gray-800">
                                  {item.ordered_quantity}
                                </p>
                              </td>


                              {/* SUPPLIER */}
                              <td className="px-4 py-4">
                                <select
                                  value={item.supplier_id}
                                  onChange={(e) =>
                                    updateSupplier(
                                      index,
                                      e.target.value
                                    )
                                  }
                                  disabled={creating || loadingSuppliers}
                                  className="w-full min-w-[220px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                                >
                                  <option value="">
                                    {loadingSuppliers ? 'Loading suppliers...' : 'Select supplier'}
                                  </option>

                                  {getAvailableSuppliers(item).map((supplier) => {
                                    const isPrimary = supplier.id === item.product_supplier_id && supplier.supplier_type === 'Manufacturer'

                                    return (
                                      <option key={supplier.id} value={supplier.id}>
                                        {supplier.supplier_name} {isPrimary ? ' (Primary)' : ''}
                                      </option>
                                    )
                                  })}
                                </select>
                              </td>


                              {/* UNIT PRICE */}
                              <td className="px-4 py-4">
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                                    ₱
                                  </span>

                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.unit_price}
                                    onChange={(e) =>
                                      updateUnitPrice(
                                        index,
                                        e.target.value
                                      )
                                    }
                                    disabled={creating}
                                    placeholder="0.00"
                                    className="w-36 rounded-md border border-gray-300 py-2 pl-7 pr-3 text-right text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                                  />
                                </div>
                              </td>


                              {/* TOTAL */}
                              <td className="px-4 py-4 text-right font-medium text-gray-800">
                                ₱ {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          )
                        }
                      )
                    ) : (
                      <tr>
                        <td colSpan="6" className=" py-10 text-center text-sm text-gray-500">
                          No products in this customer order.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>


              {/* =================================================
                  TOTAL
              ================================================= */}
              <div className="mt-6 flex justify-end">
                <div className="w-full max-w-sm rounded-lg bg-gray-50 p-5">
                  
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700">
                      Purchase Order Total
                    </span>

                    <span className="text-xl font-bold text-gray-800 ">
                      ₱ {purchaseTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>


        {/* =================================================
            FOOTER
        ================================================= */}
        <div className="flex items-center justify-end gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={creating || !expectedDeliveryDate || !customerOrderId || items.length === 0}
            className="flex items-center gap-2 rounded-md bg-[#1F3A2C] px-5 py-2 text-sm font-medium text-white hover:bg-[#294D3A] disabled:cursor-not-allowed disabled:opacity-50"
          >

            <FontAwesomeIcon icon={faFileInvoice}/>
            {creating ? 'Creating...': 'Create Purchase Order'}
          </button>
        </div>

      </div>
    </div>
  )
}

















// =====================================================
// VIEW PURCHASE ORDER MODAL
// =====================================================
function PurchaseOrderModal({purchaseOrder, onClose}) {

  const items = purchaseOrder.purchase_order_items || []

  // ===================================================
  // PURCHASE TOTAL
  // ===================================================
  const purchaseTotal =
    items.reduce(
      (total, item) => {
        return (total + (Number(item.ordered_quantity || 0) * Number(item.unit_price || 0)))
      },
      0
    )


  // ===================================================
  // ORDERED / RECEIVED
  // ===================================================
  const totalOrdered = items.reduce(
    (total, item) =>
      total + Number(item.ordered_quantity || 0),
    0
  )

  const totalReceived = items.reduce(
    (total, item) =>
      total + Number(item.received_quantity || 0),
    0
  )


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {purchaseOrder.po_number}
            </h2>

            <p className="text-sm text-gray-500">
              Purchase Order
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
              INFORMATION
          ================================================= */}
          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> PO Number </p>
              <p className="mt-1 font-medium text-gray-800"> {purchaseOrder.po_number} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Customer Order </p>
              <p className="mt-1 font-medium text-gray-800"> {purchaseOrder.customer_orders?.order_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Customer </p>
              <p className="mt-1 font-medium text-gray-800"> {purchaseOrder.customer_orders?.profile?.name || '-'} </p>

              {purchaseOrder.customer_orders?.profile?.company && (
                <p className="text-xs text-gray-500">
                  {purchaseOrder.customer_orders.profile.company}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <div className="mt-1">
                <StatusBadge status={purchaseOrder.status}/>
              </div>
            </div>
          </div>


          {/* =================================================
              ITEMS
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Purchase Order Items
          </h3>

          <div className="overflow-hidden rounded-lg border">
            <table className=" min-w-full">

              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Product
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Supplier
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Ordered
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Received
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Unit Price
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Total
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>


              <tbody>
                {items.map((item) => {
                  const itemTotal = Number(item.ordered_quantity || 0) * Number(item.unit_price || 0)

                  return (
                    <tr key={item.customer_order_item_id} className="border-t border-gray-200">

                      {/* PRODUCT */}
                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-800">
                          {item.products?.product_name || '-'}
                        </p>

                        {item.products?.brand && (
                          <p className="text-xs text-gray-500">
                            {item.products.brand}
                          </p>
                        )}
                      </td>


                      {/* SUPPLIER */}
                      <td className="px-4 py-4">
                        {item.suppliers?.supplier_name || '-'}
                      </td>


                      {/* ORDERED */}
                      <td className="px-4 py-4 text-right">
                        {item.ordered_quantity}
                      </td>


                      {/* RECEIVED */}
                      <td className="px-4 py-4 text-right">
                        {item.received_quantity}
                      </td>


                      {/* UNIT PRICE */}
                      <td className="px-4 py-4 text-right">
                        ₱ {Number(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>


                      {/* TOTAL */}
                      <td className="px-4 py-4 text-right font-medium">
                        ₱ {itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>


                      {/* STATUS */}
                      <td className="px-4 py-4">
                        <StatusBadge status={item.status}/>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

            </table>
          </div>


          {/* =================================================
              SUMMARY
          ================================================= */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-sm rounded-lg bg-gray-50 p-5">

              <div className="mb-3 flex justify-between text-sm">
                <span className="text-gray-500">
                  Total Ordered
                </span>

                <span className="font-medium">
                  {totalOrdered}
                </span>
              </div>


              <div className="mb-3 flex justify-between text-sm">
                <span className="text-gray-500">
                  Total Received
                </span>

                <span className="font-medium">
                  {totalReceived}
                </span>
              </div>


              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="font-semibold text-gray-700">
                    Purchase Total
                  </span>

                  <span className="text-xl font-bold text-gray-800">
                    ₱ {purchaseTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

            </div>
          </div>
        </div>


        {/* =================================================
            FOOTER
        ================================================= */}
        <div className="flex items-center justify-end gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  )
}