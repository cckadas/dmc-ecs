'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { createNotification } from '../services/notificationService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxesPacking, faXmark } from '@fortawesome/free-solid-svg-icons'

import IconButton from '../components/IconButton'
import StatusBadge from '../components/StatusBadge'


export default function ReceivingPage() {

  const { toast } = useToast()

  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [warehouseRacks, setWarehouseRacks] = useState([])
  const [loadingRacks, setLoadingRacks] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showReceivingModal, setShowReceivingModal] = useState(false)


  // =====================================================
  // LOAD PURCHASE ORDERS
  // =====================================================
  async function loadPurchaseOrders() {

    setLoading(true)

    const { data, error } = await supabase
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
          received_condition,
          warehouse_rack_id,
          created_at,
          updated_at,

          products (
            id,
            product_name,
            brand,
            unit
          ),

          suppliers (
            id,
            supplier_name,
            contact_person,
            email,
            phone,
            supplier_type
          ),

          warehouse_racks (
            id,
            rack_id,
            name,
            location,
            section,
            is_occupied
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


    // -----------------------------------------------------
    // GET CUSTOMER IDS
    // -----------------------------------------------------
    const customerIds = [
      ...new Set(
        (data || [])
          .map((po) => po.customer_orders?.customer_id)
          .filter(Boolean)
      )
    ]


    // -----------------------------------------------------
    // LOAD CUSTOMER PROFILES
    // -----------------------------------------------------
    let profilesMap = {}

    if (customerIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
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
        toast.error( 'Failed to load customer information.')
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


    // -----------------------------------------------------
    // ATTACH CUSTOMER PROFILE
    // -----------------------------------------------------
    const formattedPurchaseOrders =
      (data || []).map((po) => {
        const customerId = po.customer_orders?.customer_id

        return {
          ...po,
          customer_orders:
            po.customer_orders
              ? { ...po.customer_orders, profile: profilesMap[customerId] || null }
              : null
        }
      })


    setPurchaseOrders(formattedPurchaseOrders)
    setLoading(false)
  }


  // =====================================================
  // LOAD WAREHOUSE RACKS
  // =====================================================
  async function loadWarehouseRacks() {
    setLoadingRacks(true)

    const { data, error } = await supabase
      .from('warehouse_racks')
      .select(`
        id,
        rack_id,
        name,
        location,
        section,
        is_occupied
      `)
      .order('rack_id', {
        ascending: true
      })

    if (error) {
      console.error('Failed to load warehouse racks:', error)
      toast.error('Failed to load warehouse racks.')
      setLoadingRacks(false)
      return
    }

    setWarehouseRacks(data || [])
    setLoadingRacks(false)
  }


  // =====================================================
  // OPEN RECEIVING MODAL
  // =====================================================
  function openReceivingModal(item) {
    setSelectedItem(item)
    setShowReceivingModal(true)
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    loadPurchaseOrders()
    loadWarehouseRacks()
  }, [])


  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (
    <div>

      {/* =================================================
          HEADER
      ================================================= */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          Receiving
        </h1>

        <p className="mt-1 text-gray-500">
          View purchase orders and received quantities.
        </p>
      </div>


      {/* =================================================
          PURCHASE ORDERS
      ================================================= */}
      {loading ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          Loading purchase orders...
        </div>

      ) : purchaseOrders.length === 0 ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
          <FontAwesomeIcon icon={faBoxesPacking} className="mb-3 h-8 w-8 text-gray-300"/>

          <p className="text-sm text-gray-500">
            No purchase orders found.
          </p>
        </div>

      ) : (

        <div className="space-y-6">
          {purchaseOrders.map((po) => {
            const items =po.purchase_order_items || []

            // -------------------------------------------------
            // RECEIVING TOTALS
            // -------------------------------------------------
            const totalOrdered = items.reduce((total, item) => total + Number(item.ordered_quantity || 0), 0)
            const totalReceived = items.reduce((total, item) => total + Number( item.received_quantity || 0), 0)
            const remaining = totalOrdered - totalReceived

            return (
              <div key={po.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

                {/* =================================================
                    PO HEADER
                ================================================= */}
                <div className="border-b border-gray-200 bg-[#F4F8F5] px-6 py-5">
                  <div className="flex items-start justify-between">

                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-[#1F3A2C]">
                          {po.po_number}
                        </h2>

                        <StatusBadge status={po.status}/>
                      </div>


                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
                        <span>
                          Customer Order:{' '}
                          <span className="font-medium text-gray-700">
                            {po.customer_orders?.order_number || '-'}
                          </span>
                        </span>

                        <span>
                          Customer:{' '}
                          <span className="font-medium text-gray-700">
                            {po.customer_orders?.profile?.name || '-'}
                          </span>
                        </span>

                        {po.expected_delivery_date && (
                          <span>
                            Expected Delivery:{' '}
                            <span className="font-medium text-gray-700">
                              {new Date(
                                po.expected_delivery_date
                              ).toLocaleDateString()}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>


                    {/* =================================================
                        RECEIVING SUMMARY
                    ================================================= */}
                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Ordered
                        </p>

                        <p className="mt-1 text-lg font-semibold text-gray-800">
                          {totalOrdered}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Received
                        </p>

                        <p className="mt-1 text-lg font-semibold text-[#2D5A42]">
                          {totalReceived}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Remaining
                        </p>

                        <p className="mt-1 text-lg font-semibold text-gray-800">
                          {remaining}
                        </p>
                      </div>
                    </div>

                  </div>
                </div>


                {/* =================================================
                    ITEMS TABLE
                ================================================= */}
                <div className="overflow-x-auto">
                  <table className="min-w-full">

                    <thead className="bg-white">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Product
                        </th>

                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Supplier
                        </th>

                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Ordered
                        </th>

                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Received
                        </th>

                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Remaining
                        </th>

                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Status
                        </th>

                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Action
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {items.length > 0 ? (
                        items.map((item) => {

                          const ordered = Number(item.ordered_quantity || 0)
                          const received = Number(item.received_quantity || 0)
                          const remaining = Math.max(ordered - received, 0)

                          return (
                            <tr key={item.id} className="border-t border-gray-200">

                              {/* PRODUCT */}
                              <td className="px-6 py-4">
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
                              <td className="px-6 py-4">
                                <p className="text-sm text-gray-700">
                                  {item.suppliers?.supplier_name || '-'}
                                </p>
                              </td>

                              {/* ORDERED */}
                              <td className="px-6 py-4 text-right font-medium text-gray-700">
                                {ordered}
                              </td>

                              {/* RECEIVED */}
                              <td className="px-6 py-4 text-right font-medium text-[#2D5A42]">
                                {received}
                              </td>

                              {/* REMAINING */}
                              <td className="px-6 py-4 text-right font-medium text-gray-700">
                                {remaining}
                              </td>

                              {/* STATUS */}
                              <td className="px-6 py-4">
                                <StatusBadge status={item.status}/>
                              </td>

                              {/* STATUS */}
                              <td className="px-6 py-4">
                                <IconButton
                                  icon={faBoxesPacking}
                                  title="Receive Delivery"
                                  color="blue"
                                  disabled={item.status === 'sent to supplier' || item.status === 'fully delivered' || remaining === 0}
                                  onClick={() => openReceivingModal({...item, purchase_order_id: po.id })}
                                />
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan="7" className="px-6 py-8 text-center text-sm text-gray-500">
                            No items found for this purchase order.
                          </td>
                        </tr>
                      )}
                    </tbody>

                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}


      {showReceivingModal && selectedItem && (
        <ReceivingModal
          item={selectedItem}
          warehouseRacks={warehouseRacks}
          loadingRacks={loadingRacks}
          onClose={() => {
            setShowReceivingModal(false)
            setSelectedItem(null)
          }}
          onSuccess={async () => {
            setShowReceivingModal(false)
            setSelectedItem(null)
            await loadPurchaseOrders()
            await loadWarehouseRacks()
          }}
        />
      )}


    </div>
  )
}






// =====================================================
// OPEN RECEIVING MODAL
// =====================================================
function ReceivingModal({ item, warehouseRacks, loadingRacks, onClose, onSuccess }) {
  const { toast } = useToast()

  const orderedQuantity = Number(item.ordered_quantity || 0)
  const currentReceived = Number(item.received_quantity || 0)
  const remaining = Math.max(orderedQuantity - currentReceived, 0)

  const [receivedQuantity, setReceivedQuantity] = useState(currentReceived)
  const [condition, setCondition] = useState(item.received_condition || 'good')
  const [rackId, setRackId] = useState(item.warehouse_rack_id || '')
  const [saving, setSaving] = useState(false)


  // =====================================================
  // HANDLE SAVE
  // =====================================================
  async function handleSave() {
    const quantity = Number(receivedQuantity)

    if (Number.isNaN(quantity) || quantity < 0) {
      toast.error('Please enter a valid received quantity.')
      return
    }

    if (quantity > orderedQuantity) {
      toast.error('Received quantity cannot exceed ordered quantity.')
      return
    }

    if (quantity > 0 && !rackId) {
      toast.error('Please select a warehouse rack.')
      return
    }

    setSaving(true)


    try {

      // =================================================
      // GET CURRENT RACK
      // =================================================
      const oldRackId = item.warehouse_rack_id || null


      // =================================================
      // CHECK NEW RACK AVAILABILITY
      // =================================================
      if (quantity > 0 && rackId) {

        // Only check if the rack is different
        // from the item's current rack.
        if (rackId !== oldRackId) {
          const { data: rack, error: rackError } = await supabase
            .from('warehouse_racks')
            .select(`
              id,
              rack_id,
              name,
              is_occupied
            `)
            .eq('id', rackId)
            .single()


          if (rackError) {
            throw rackError
          }

          if (rack.is_occupied) {
            toast.error(`Rack ${rack.name || rack.rack_id} is already occupied.`)
            return
          }
        }
      }


      // =================================================
      // DETERMINE ITEM STATUS
      // =================================================
      const itemStatus =
        quantity === 0
          ? 'sent to supplier'
          : quantity < orderedQuantity
            ? 'partially delivered'
            : 'fully delivered'


      // =================================================
      // FREE OLD RACK
      // =================================================
      if (oldRackId && ( quantity === 0 || rackId !== oldRackId)) {
        const { error: oldRackError } = await supabase
          .from('warehouse_racks')
          .update({
            is_occupied: false
          })
          .eq('id', oldRackId)

        if (oldRackError) {
          throw oldRackError
        }
      }


      // =================================================
      // OCCUPY NEW RACK
      // =================================================
      if (quantity > 0 && rackId) {
        const { error: newRackError } = await supabase
          .from('warehouse_racks')
          .update({
            is_occupied: true
          })
          .eq('id', rackId)

        if (newRackError) {
          throw newRackError
        }
      }


      // =================================================
      // UPDATE PO ITEM
      // =================================================
      const { error: itemError } = await supabase
        .from('purchase_order_items')
        .update({
          received_quantity: quantity,
          received_condition: condition,
          warehouse_rack_id: quantity > 0 ? rackId : null,
          status: itemStatus
        })
        .eq('id', item.id)

      if (itemError) {
        throw itemError
      }


      // =================================================
      // LOAD ALL ITEMS FROM THIS PO
      // =================================================
      const { data: poItems, error: poItemsError} = await supabase
        .from('purchase_order_items')
        .select(`
          id,
          ordered_quantity,
          received_quantity
        `)
        .eq(
          'purchase_order_id',
          item.purchase_order_id
        )

      if (poItemsError) {
        throw poItemsError
      }


      // =================================================
      // DETERMINE PO STATUS
      // =================================================
      const totalOrdered = (poItems || []).reduce((total, poItem) => total + Number(poItem.ordered_quantity || 0), 0)
      const totalReceived = (poItems || []).reduce((total, poItem) => total + Number(poItem.received_quantity || 0), 0)

      let poStatus = 'sent to supplier'

      if (totalReceived > 0 && totalReceived < totalOrdered) {
        poStatus = 'partially delivered'
      }

      if (totalOrdered > 0 && totalReceived >= totalOrdered) {
        poStatus ='fully delivered'
      }


      // =================================================
      // UPDATE PURCHASE ORDER STATUS
      // =================================================
      const {  error: poError } = await supabase
        .from('purchase_orders')
        .update({
          status: poStatus
        })
        .eq('id', item.purchase_order_id)

      if (poError) {
        throw poError
      }


      // =================================================
      // UPDATE CUSTOMER ORDER STATUS
      // =================================================
      if (poStatus === 'fully delivered') {

        // -------------------------------------------------
        // GET CUSTOMER ORDER ID FROM PURCHASE ORDER
        // -------------------------------------------------
        const { data: purchaseOrder, error: purchaseOrderError} = await supabase
          .from('purchase_orders')
          .select(`
            id,
            customer_order_id
          `)
          .eq('id', item.purchase_order_id)
          .single()

        if (purchaseOrderError) {
          throw purchaseOrderError
        }


        // -------------------------------------------------
        // UPDATE CUSTOMER ORDER
        // -------------------------------------------------
        if (purchaseOrder?.customer_order_id) {
          const { error: customerOrderError} = await supabase
            .from('customer_orders')
            .update({
              status: 'warehouse preparation'
            })
            .eq('id', purchaseOrder.customer_order_id)

          if (customerOrderError) {
            throw customerOrderError
          }

          const { error: historyError } = await supabase
            .from('customer_order_status_history')
            .insert({
              customer_order_id: purchaseOrder.customer_order_id,
              previous_status: 'procurement',
              new_status: 'warehouse preparation',
              changed_at: new Date().toISOString()
            })

          if (historyError) {
            throw historyError
          }


          // =============================================
          // GET CUSTOMER ID
          // =============================================
          const { data: customerOrder, error: customerError } = await supabase
            .from('customer_orders')
            .select('customer_id, order_number')
            .eq('id', purchaseOrder.customer_order_id)
            .single()

          if (customerError) {
            throw customerError
          }

          if (!customerOrder?.customer_id) {
            throw new Error('Customer ID not found for this order.')
          }


          // =============================================
          // CREATE NOTIFICATION
          // =============================================
          await createNotification({
            userId: customerOrder.customer_id,
            role: 'customer',
            title: `${customerOrder.order_number} is now in warehouse preparation`,
            message: `Your order ${customerOrder.order_number} status is now "Warehouse Preparation". Please check your order details for more information.`,
            type: 'info',
            relatedCustomerOrderId: purchaseOrder.customer_order_id,
            link: '/my-orders',
          })
        }
      }


      // =================================================
      // SUCCESS
      // =================================================
      toast.success('Receiving information saved successfully.')
      onSuccess()
    }
    
    catch (error) {
      console.error('Failed to save receiving:', error)
      toast.error(error.message || 'Failed to save receiving information.')
    }
    
    finally {
      setSaving(false)
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {item.products?.product_name || '-'}
            </h2>

            <p className="text-sm text-gray-500">
              Receive Item
            </p>
          </div>

          <button onClick={onClose} className=" rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>


        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="space-y-5 p-6">

          {/* =================================================
              PRODUCT SUMMARY
          ================================================= */}
          <h3 className="mb-4 text-sm font-semibold text-gray-800">
            Payment Summary
          </h3>

          <div className="rounded-lg bg-gray-50 p-4">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">
                Ordered
              </span>

              <span className="font-medium text-gray-800">
                {orderedQuantity}
              </span>
            </div>

            <div className="mt-2 flex justify-between">
              <span className="text-sm text-gray-500">
                Previously Received
              </span>

              <span className="font-medium text-[#2D5A42]">
                {currentReceived}
              </span>
            </div>

            <div className="mt-2 flex justify-between border-t pt-2">
              <span className="text-sm font-medium text-gray-700">
                Remaining
              </span>

              <span className="font-semibold text-gray-800">
                {remaining}
              </span>
            </div>
          </div>


          {/* =================================================
              RECEIVED QUANTITY
          ================================================= */}
          <div className="mt-6">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Quantity Received
            </label>

            <input
              type="number"
              min="0"
              max={orderedQuantity}
              value={receivedQuantity}
              onChange={(e) =>
                setReceivedQuantity(
                  e.target.value
                )
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
            />
          </div>


          {/* =================================================
              RECEIVED QUANTITY
          ================================================= */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Condition
            </label>

            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
            >
              <option value="good">
                Good
              </option>

              <option value="damaged">
                Damaged
              </option>

              <option value="missing">
                Missing
              </option>

              <option value="wrong item">
                Wrong Item
              </option>
            </select>
          </div>


          {/* =================================================
              RACKS
          ================================================= */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Warehouse Rack
            </label>

            <select
              value={rackId}
              onChange={(e) => setRackId(e.target.value)}
              disabled={loadingRacks}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
            >
              <option value="">
                Select a rack
              </option>

              {warehouseRacks.map((rack) => (
                <option
                  key={rack.id}
                  value={rack.id}
                  disabled={rack.is_occupied}
                  className={rack.is_occupied ? 'bg-gray-100 text-gray-400' : ''}
                >
                  {rack.rack_id} — {rack.name}
                  {rack.section ? ` — ${rack.section}` : ''}
                  {rack.is_occupied ? ' — Occupied' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>


        {/* =================================================
            FOOTER
        ================================================= */}
        <div className="flex justify-end gap-3 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633] disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Receiving'}
          </button>
        </div>
      </div>
    </div>
  )
}