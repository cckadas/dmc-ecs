'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxOpen, faPaperPlane } from '@fortawesome/free-solid-svg-icons'

import StatusBadge from '../components/StatusBadge'


export default function StagingTrackerPage() {

  const { toast } = useToast()

  const [customerOrders, setCustomerOrders] = useState([])
  const [loading, setLoading] = useState(true)


  // =====================================================
  // LOAD CUSTOMER ORDERS
  // =====================================================
  async function loadCustomerOrders() {

    setLoading(true)

    try {
      const { data: orders, error: ordersError } = await supabase
        .from('customer_orders')
        .select(`
          id,
          order_number,
          customer_id,
          quotation_number,
          total_amount,
          status,
          delivery_location_id,
          created_at
        `)
        .in('status', ['warehouse preparation', 'ready for shipment'])
        .order('created_at', {
          ascending: false
        })

      if (ordersError) {
        throw ordersError
      }

      if (!orders || orders.length === 0) {
        setCustomerOrders([])
        return
      }


      // =================================================
      // GET CUSTOMER ORDER IDS
      // =================================================
      const customerOrderIds = orders
        .map((order) => order.id)
        .filter(Boolean)


      // =================================================
      // LOAD CUSTOMER ORDER ITEMS
      // =================================================
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('customer_order_items')
        .select(`
          id,
          customer_order_id,
          product_id,
          quantity,
          unit_price,
          subtotal,

          products (
            id,
            product_name,
            brand,
            unit
          )
        `)
        .in(
          'customer_order_id',
          customerOrderIds
        )

      if (orderItemsError) {
        throw orderItemsError
      }


      // =================================================
      // GET ORDER ITEM IDS
      // =================================================
      const orderItemIds =
        (orderItems || [])
          .map((item) => item.id)
          .filter(Boolean)


      // =================================================
      // LOAD COMPLIANCE LABEL EXCHANGES
      // =================================================
      let exchangesMap = {}

      if (orderItemIds.length > 0) {
        const { data: exchanges, error: exchangesError } = await supabase
          .from('compliance_label_exchanges')
          .select(`
            id,
            customer_order_item_id,
            original_label_path,
            customer_design_path,
            status,
            created_at,
            updated_at
          `)
          .in(
            'customer_order_item_id',
            orderItemIds
          )

        if (exchangesError) {
          throw exchangesError
        }

        exchangesMap = (exchanges || []).reduce(
            (map, exchange) => {
              map[exchange.customer_order_item_id] = exchange
              return map
            },
            {}
          )
      }


      // =================================================
      // LOAD DELIVERY LOCATIONS
      // =================================================
      const deliveryLocationIds = [
        ...new Set(
          orders
            .map((order) => order.delivery_location_id)
            .filter(Boolean)
        )
      ]

      let deliveryLocationsMap = {}

      if (deliveryLocationIds.length > 0) {
        const { data: deliveryLocations, error: deliveryLocationError } = await supabase
          .from('delivery_locations')
          .select(`
            id,
            country
          `)
          .in(
            'id',
            deliveryLocationIds
          )

        if (deliveryLocationError) {
          throw deliveryLocationError
        }

        deliveryLocationsMap = (deliveryLocations || []).reduce(
            (map, location) => {
              map[location.id] = location
              return map
            },
            {}
          )
      }


      // =================================================
      // LOAD CUSTOMER PROFILES
      // =================================================
      const customerIds = [
        ...new Set(
          orders
            .map((order) => order.customer_id)
            .filter(Boolean)
        )
      ]

      let profilesMap = {}

      if (customerIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select(`
            id,
            name,
            email,
            company
          `)
          .in(
            'id',
            customerIds
          )

        if (profileError) {
          throw profileError
        }

        profilesMap = (profiles || []).reduce(
            (map, profile) => {
              map[profile.id] = profile
              return map
            },
            {}
          )
      }


      // =================================================
      // GROUP ITEMS BY CUSTOMER ORDER
      // =================================================
      const groupedOrders = {}

      // First, create groups for ALL customer orders that
      // have at least one item ready for staging.
      ;(orderItems || []).forEach((item) => {

        const exchange = exchangesMap[item.id] || null

        const customerOrder = orders.find(
          (order) => order.id === item.customer_order_id
        )

        if (!customerOrder) {
          return
        }

        // =================================================
        // ONLY ADD TO STAGING ITEMS IF APPLIED TO UNITS
        // =================================================
        if (exchange?.status !== 'applied to units') {
          return
        }

        // =================================================
        // CREATE CUSTOMER ORDER GROUP
        // =================================================
        if (!groupedOrders[customerOrder.id]) {

          groupedOrders[customerOrder.id] = {
            customer_order: {
              ...customerOrder,
              profile:
                profilesMap[customerOrder.customer_id] || null,
              delivery_location:
                deliveryLocationsMap[
                  customerOrder.delivery_location_id
                ] || null
            },

            items: [],

            // Total number of customer order items
            total_items: 0
          }
        }

        // =================================================
        // ADD READY ITEM
        // =================================================
        groupedOrders[customerOrder.id].items.push({
          ...item,
          compliance_label_exchange: exchange
        })
      })


      // =================================================
      // CALCULATE TOTAL ITEMS FOR EACH CUSTOMER ORDER
      // =================================================
      Object.values(groupedOrders).forEach((orderGroup) => {

        const customerOrderId =
          orderGroup.customer_order.id

        orderGroup.total_items =
          (orderItems || []).filter(
            (item) =>
              item.customer_order_id === customerOrderId
          ).length
      })


      // =================================================
      // ONLY KEEP ORDERS THAT HAVE STAGING ITEMS
      // =================================================
      const formattedOrders =
        Object.values(groupedOrders)
          .filter(
            (orderGroup) =>
              orderGroup.items.length > 0
          )

      setCustomerOrders(formattedOrders)
    }

    catch (error) {
      console.error('Failed to load staging orders:', error)
      toast.error(error.message || 'Failed to load staging orders.')
    }

    finally {
      setLoading(false)
    }
  }


  // =====================================================
  // MARK CUSTOMER ORDER AS SHIPPED
  // =====================================================
  async function markOrderAsShipped(order) {

    if (!order?.id) {
      toast.error('Missing customer order.')
      return
    }

    setLoading(true)

    try {

      // =================================================
      // GET PURCHASE ORDERS FOR CUSTOMER ORDER
      // =================================================
      const { data: purchaseOrders, error: purchaseOrderError } =
        await supabase
          .from('purchase_orders')
          .select(`
            id
          `)
          .eq('customer_order_id', order.id)

      if (purchaseOrderError) {
        throw purchaseOrderError
      }


      // =================================================
      // GET PURCHASE ORDER IDS
      // =================================================
      const purchaseOrderIds = (purchaseOrders || [])
        .map((po) => po.id)
        .filter(Boolean)


      // =================================================
      // GET PURCHASE ORDER ITEMS + THEIR RACKS
      // =================================================
      let rackIds = []

      if (purchaseOrderIds.length > 0) {

        const { data: purchaseOrderItems, error: itemsError } =
          await supabase
            .from('purchase_order_items')
            .select(`
              id,
              warehouse_rack_id
            `)
            .in('purchase_order_id', purchaseOrderIds)

        if (itemsError) {
          throw itemsError
        }


        // =================================================
        // GET UNIQUE RACK IDS
        // =================================================
        rackIds = [
          ...new Set(
            (purchaseOrderItems || [])
              .map((item) => item.warehouse_rack_id)
              .filter(Boolean)
          )
        ]
      }


      // =================================================
      // REMOVE ITEMS FROM WAREHOUSE RACKS
      // =================================================
      if (purchaseOrderIds.length > 0) {

        const { error: rackItemError } = await supabase
          .from('purchase_order_items')
          .update({
            warehouse_rack_id: null,
            updated_at: new Date().toISOString()
          })
          .in('purchase_order_id', purchaseOrderIds)

        if (rackItemError) {
          throw rackItemError
        }
      }


      // =================================================
      // MARK RACKS AS AVAILABLE
      // =================================================
      if (rackIds.length > 0) {
        const { error: rackError } = await supabase
          .from('warehouse_racks')
          .update({
            is_occupied: false,
            updated_at: new Date().toISOString()
          })
          .in('id', rackIds)

        if (rackError) {
          throw rackError
        }
      }


      // =================================================
      // UPDATE CUSTOMER ORDER
      // =================================================
      const { error: customerOrderError } =
        await supabase
          .from('customer_orders')
          .update({
            status: 'shipped'
          })
          .eq('id', order.id)

      if (customerOrderError) {
        throw customerOrderError
      }


      // =================================================
      // SUCCESS
      // =================================================
      toast.success('Customer order marked as shipped successfully.')
      await loadCustomerOrders()
    }

    catch (error) {
      console.error('Failed to mark customer order as shipped:', error)
      toast.error(error.message || 'Failed to mark customer order as shipped.')
    }

    finally {
      setLoading(false)
    }
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    loadCustomerOrders()
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
          Staging Tracker
        </h1>

        <p className="mt-1 text-gray-500">
          Manage customer order items that have been labeled and are ready for staging.
        </p>
      </div>



      {/* =================================================
          LOADING
      ================================================= */}
      {loading ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          Loading staging orders...
        </div>

      ) : customerOrders.length === 0 ? (

        /* =================================================
           EMPTY STATE
        ================================================= */
        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
          <FontAwesomeIcon icon={faBoxOpen} className="mb-3 h-8 w-8 text-gray-300"/>

          <p className="text-sm text-gray-500">
            No customer order items are ready for staging.
          </p>
        </div>

      ) : (

        /* =================================================
           CUSTOMER ORDERS
        ================================================= */
        <div className="space-y-6">
          {customerOrders.map((orderGroup) => {

              const customerOrder =  orderGroup.customer_order
              const items = orderGroup.items || []

              return (
                <div key={customerOrder.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

                  {/* =================================================
                      CUSTOMER ORDER HEADER
                  ================================================= */}
                  <div className="border-b border-gray-200 bg-[#F4F8F5] px-6 py-5">
                    <div className="flex items-start justify-between">

                      {/* ---------------------------------------------
                          ORDER INFORMATION
                      --------------------------------------------- */}
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-lg font-semibold text-[#1F3A2C]">
                            {customerOrder.order_number || '-'}
                          </h2>

                          <StatusBadge status={customerOrder.status}/>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
                          <span>
                            Quotation:{' '}
                            <span className="font-medium text-gray-700">
                              {customerOrder.quotation_number || '-'}
                            </span>
                          </span>

                          <span>
                            Customer:{' '}
                            <span className="font-medium text-gray-700">
                              {customerOrder.profile?.name || '-'}
                            </span>
                          </span>

                          {customerOrder.profile?.company && (
                            <span>
                              Company:{' '}
                              <span className="font-medium text-gray-700">
                                {customerOrder.profile.company}
                              </span>
                            </span>
                          )}

                          <span>
                            Country:{' '}
                            <span className="font-medium text-gray-700">
                              {customerOrder.delivery_location?.country || '-'}
                            </span>
                          </span>
                        </div>
                      </div>


                      {/* ---------------------------------------------
                          SUMMARY + READY FOR SHIPMENT
                      --------------------------------------------- */}
                      <div className="flex items-center gap-8">

                        {/* READY ITEMS */}
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Items Ready
                          </p>

                          <p className="mt-1 text-lg font-semibold text-[#2D5A42]">
                            {items.length}
                            <span className="text-sm font-normal text-gray-400">
                              {' '}/ {orderGroup.total_items}
                            </span>
                          </p>
                        </div>


                        {/* READY FOR SHIPMENT BUTTON */}
                        <button
                          type="button"
                          disabled={items.length < Number(orderGroup.total_items)}
                          onClick={() => markOrderAsShipped(customerOrder)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#234A35] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <FontAwesomeIcon icon={faPaperPlane} className="h-4 w-4"/>

                          Ready for Shipment
                        </button>

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
                            Quantity
                          </th>

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Country
                          </th>

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Compliance Status
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {items.map(
                          (item) => {

                            const exchange = item.compliance_label_exchange

                            return (
                              <tr key={item.id} className="border-t border-gray-200 hover:bg-gray-50">

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

                                {/* QUANTITY */}
                                <td className="px-6 py-4 font-medium text-gray-700">
                                  {item.quantity}
                                  {item.products?.unit && (
                                    <span className="ml-1 text-xs text-gray-500">
                                      {item.products.unit}
                                    </span>
                                  )}
                                </td>

                                {/* COUNTRY */}
                                <td className="px-6 py-4">
                                  <span className="text-sm text-gray-700">
                                    {customerOrder.delivery_location?.country || '-'}
                                  </span>
                                </td>

                                {/* COMPLIANCE STATUS */}
                                <td className="px-6 py-4">
                                  <StatusBadge status={exchange?.status}/>
                                </td>
                              </tr>
                            )
                          }
                        )}
                      </tbody>

                    </table>
                  </div>
                </div>
              )
            }
          )}
        </div>
      )}
    </div>
  )
}