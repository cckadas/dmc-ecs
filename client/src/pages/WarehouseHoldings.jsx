'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faWarehouse, faMagnifyingGlass, faBox, faLocationDot } from '@fortawesome/free-solid-svg-icons'

import StatusBadge from '../components/StatusBadge'


export default function WarehouseHoldingsPage() {

  const { toast } = useToast()

  const [warehouseItems, setWarehouseItems] = useState([])
  const [racks, setRacks] = useState([])

  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)


  // =====================================================
  // LOAD WAREHOUSE LOCATION
  // =====================================================
  async function loadWarehouseLocation() {

    setLoading(true)

    try {

      // =================================================
      // LOAD PURCHASE ORDER ITEMS CURRENTLY IN RACKS
      // =================================================
      const { data: purchaseOrderItems, error: purchaseOrderItemsError } = await supabase
        .from('purchase_order_items')
        .select(`
          id,
          purchase_order_id,
          product_id,
          ordered_quantity,
          received_quantity,
          unit_price,
          status,
          warehouse_rack_id,

          products (
            id,
            product_name,
            brand,
            unit
          )
        `)
        .not('warehouse_rack_id', 'is', null)

      if (purchaseOrderItemsError) {
        throw purchaseOrderItemsError
      }


      // =================================================
      // LOAD ALL ACTIVE RACKS
      // =================================================
      const { data: warehouseRacks, error: warehouseRacksError } = await supabase
        .from('warehouse_racks')
        .select(`
          id,
          rack_id,
          name,
          location,
          section,
          description,
          is_active,
          is_occupied
        `)
        .eq('is_active', true)

      if (warehouseRacksError) {
        throw warehouseRacksError
      }

      setRacks(warehouseRacks || [])


      // =================================================
      // NO ITEMS IN RACKS
      // =================================================
      if (!purchaseOrderItems || purchaseOrderItems.length === 0) {
        setWarehouseItems([])
        return
      }


      // =================================================
      // GET PURCHASE ORDER IDS
      // =================================================
      const purchaseOrderIds = [
        ...new Set(
          purchaseOrderItems
            .map((item) => item.purchase_order_id)
            .filter(Boolean)
        )
      ]

      if (purchaseOrderIds.length === 0) {
        setWarehouseItems([])
        return
      }


      // =================================================
      // LOAD PURCHASE ORDERS
      // =================================================
      const { data: purchaseOrders, error: purchaseOrdersError } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          customer_order_id,
          status,
          created_at
        `)
        .in('id', purchaseOrderIds)

      if (purchaseOrdersError) {
        throw purchaseOrdersError
      }

      if (!purchaseOrders || purchaseOrders.length === 0) {
        setWarehouseItems([])
        return
      }


      // =================================================
      // MAP PURCHASE ORDERS
      // =================================================
      const purchaseOrdersMap = {}

      purchaseOrders.forEach((purchaseOrder) => {
        purchaseOrdersMap[String(purchaseOrder.id)] = purchaseOrder
      })


      // =================================================
      // GET CUSTOMER ORDER IDS
      // =================================================
      const customerOrderIds = [
        ...new Set(
          purchaseOrders
            .map((purchaseOrder) => purchaseOrder.customer_order_id)
            .filter(Boolean)
        )
      ]

      if (customerOrderIds.length === 0) {
        setWarehouseItems([])
        return
      }


      // =================================================
      // LOAD CUSTOMER ORDERS
      // =================================================
      const { data: customerOrders, error: customerOrdersError } = await supabase
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
        .in('id', customerOrderIds)

      if (customerOrdersError) {
        throw customerOrdersError
      }


      // =================================================
      // ONLY KEEP ACTIVE CUSTOMER ORDERS
      // =================================================
      const activeCustomerOrders =
        (customerOrders || []).filter((order) => {
          const status = order.status?.toLowerCase()
          return ![ 'shipped', 'completed', 'cancelled' ].includes(status)
        })

      if (activeCustomerOrders.length === 0) {
        setWarehouseItems([])
        return
      }


      // =================================================
      // MAP CUSTOMER ORDERS
      // =================================================
      const customerOrdersMap = {}

      activeCustomerOrders.forEach((customerOrder) => {
        customerOrdersMap[String(customerOrder.id)] = customerOrder
      })


      // =================================================
      // GET DELIVERY LOCATION IDS
      // =================================================
      const deliveryLocationIds = [
        ...new Set(
          activeCustomerOrders
            .map((order) => order.delivery_location_id)
            .filter(Boolean)
        )
      ]


      // =================================================
      // LOAD DELIVERY LOCATIONS
      // =================================================
      let deliveryLocationsMap = {}

      if (deliveryLocationIds.length > 0) {
        const { data: deliveryLocations, error: deliveryLocationsError } = await supabase
          .from('delivery_locations')
          .select(`
            id,
            country
          `)
          .in('id', deliveryLocationIds)

        if (deliveryLocationsError) {
          throw deliveryLocationsError
        }


        deliveryLocationsMap = (deliveryLocations || [])
          .reduce(
            (map, location) => {
              map[String(location.id)] = location
              return map
            },
            {}
          )
      }


      // =================================================
      // GET CUSTOMER IDS
      // =================================================
      const customerIds = [
        ...new Set(
          activeCustomerOrders
            .map((order) => order.customer_id)
            .filter(Boolean)
        )
      ]


      // =================================================
      // LOAD CUSTOMER PROFILES
      // =================================================
      let profilesMap = {}

      if (customerIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select(`
            id,
            name,
            email,
            company
          `)
          .in('id', customerIds)

        if (profilesError) {
          throw profilesError
        }

        profilesMap =
          (profiles || []).reduce(
            (map, profile) => {
              map[String(profile.id)] = profile
              return map
            },
            {}
          )
      }


      // =================================================
      // MAP ACTIVE CUSTOMER ORDER IDS
      // =================================================
      const activeCustomerOrderIds = new Set(activeCustomerOrders.map((order) => String(order.id)))


      // =================================================
      // MAP WAREHOUSE RACKS
      // =================================================
      const racksMap = (warehouseRacks || [])
        .reduce(
          (map, rack) => {
            map[String(rack.id)] = rack
            return map
          },
          {}
        )


      // =================================================
      // FORMAT WAREHOUSE ITEMS
      // =================================================
      const formattedItems = []

      purchaseOrderItems.forEach((item) => {

        // ---------------------------------------------
        // GET PURCHASE ORDER
        // ---------------------------------------------
        const purchaseOrder = purchaseOrdersMap[String(item.purchase_order_id)]
        if (!purchaseOrder) { return }

        // ---------------------------------------------
        // GET CUSTOMER ORDER
        // ---------------------------------------------
        const customerOrder = customerOrdersMap[String(purchaseOrder.customer_order_id)]
        if (!customerOrder) { return }

        // ---------------------------------------------
        // ONLY ACTIVE CUSTOMER ORDERS
        // ---------------------------------------------
        if (!activeCustomerOrderIds.has(String(purchaseOrder.customer_order_id))) {
          return
        }

        // ---------------------------------------------
        // GET CUSTOMER PROFILE
        // ---------------------------------------------
        const customer = profilesMap[String(customerOrder.customer_id)] || null

        // ---------------------------------------------
        // GET DELIVERY LOCATION
        // ---------------------------------------------
        const deliveryLocation = deliveryLocationsMap[String(customerOrder.delivery_location_id)] || null

        // ---------------------------------------------
        // GET WAREHOUSE RACK
        // ---------------------------------------------
        const warehouseRack = racksMap[String(item.warehouse_rack_id)] || null

        // ---------------------------------------------
        // FINAL OBJECT
        // ---------------------------------------------
        formattedItems.push({
          ...item,
          purchase_order: purchaseOrder,
          customer_order: {
            ...customerOrder,
            profile: customer,
            delivery_location: deliveryLocation
          },
          warehouse_rack: warehouseRack
        })
      })


      // =================================================
      // SET DATA
      // =================================================
      setWarehouseItems(formattedItems)

    }

    catch (error) {
      console.error('Failed to load warehouse location:', error)
      toast.error(error.message || 'Failed to load warehouse location.')
    }

    finally {
      setLoading(false)
    }
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    loadWarehouseLocation()
  }, [])


  // =====================================================
  // FILTER ITEMS
  // =====================================================
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return warehouseItems
    }

    return warehouseItems.filter((item) => {
      const product = item.products
      const purchaseOrder = item.purchase_order
      const customerOrder = item.customer_order
      const customer = customerOrder?.profile
      const rack = item.warehouse_rack

      return (
        product?.product_name?.toLowerCase() .includes(query) ||
        product?.brand?.toLowerCase().includes(query) ||
        purchaseOrder?.po_number?.toLowerCase().includes(query) ||
        customerOrder?.order_number?.toLowerCase().includes(query) ||
        customer?.name?.toLowerCase().includes(query) ||
        customer?.company?.toLowerCase().includes(query) ||
        rack?.rack_id?.toLowerCase().includes(query) ||
        rack?.name?.toLowerCase().includes(query) ||
        rack?.location?.toLowerCase().includes(query)
      )
    })
  }, [warehouseItems, search])


  // =====================================================
  // SUMMARY
  // =====================================================
  const totalItems = filteredItems.length
  const occupiedRackCount = racks.filter((rack) => rack.is_occupied).length
  const activeLocationCount = racks.length


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
          Warehouse Holdings
        </h1>

        <p className="mt-1 text-gray-500">
          View items currently inside the warehouse and their assigned locations.
        </p>
      </div>


      {/* =================================================
          SUMMARY
      ================================================= */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">

        {/* ITEMS */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Items in Warehouse
              </p>

              <p className="mt-2 text-2xl font-bold text-[#1F3A2C]">
                {totalItems}
              </p>
            </div>

            <div className="rounded-lg bg-[#2D5A42] p-3 text-white">
              <FontAwesomeIcon icon={faBox} className="h-5 w-5"/>
            </div>
          </div>
        </div>


        {/* OCCUPIED RACKS */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Occupied Racks
              </p>

              <p className="mt-2 text-2xl font-bold text-[#1F3A2C]">
                {occupiedRackCount}
              </p>
            </div>

            <div className="rounded-lg bg-[#2D5A42] p-3 text-white">
              <FontAwesomeIcon icon={faWarehouse} className="h-5 w-5"/>
            </div>
          </div>
        </div>


        {/* ACTIVE LOCATIONS */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Active Locations
              </p>

              <p className="mt-2 text-2xl font-bold text-[#1F3A2C]">
                {activeLocationCount}
              </p>
            </div>

            <div className="rounded-lg bg-[#2D5A42] p-3 text-white">
              <FontAwesomeIcon icon={faLocationDot} className="h-5 w-5"/>
            </div>
          </div>
        </div>
      </div>


      {/* =================================================
          SEARCH
      ================================================= */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"/>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, order, customer, rack..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#2D5A42] focus:ring-1 focus:ring-[#2D5A42]"
          />
        </div>
      </div>


      {/* =================================================
          LOADING
      ================================================= */}
      {loading ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          Loading warehouse locations...
        </div>

      ) : filteredItems.length === 0 ? (

        /* =================================================
           EMPTY STATE
        ================================================= */
        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
          <FontAwesomeIcon icon={faWarehouse} className="mb-3 h-8 w-8 text-gray-300"/>

          <p className="text-sm font-medium text-gray-600">
            {search ? 'No warehouse items match your search.' : 'The warehouse is currently empty.'}
          </p>

          <p className="mt-1 text-xs text-gray-400">
            Only items belonging to active customer orders are shown here.
          </p>
        </div>

      ) : (

        /* =================================================
           WAREHOUSE ITEMS TABLE
        ================================================= */
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full">

              <thead className="bg-[#F4F8F5]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Location
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Product
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Quantity
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Customer Order
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Customer
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredItems.map((item) => {

                  const product = item.products
                  const purchaseOrder = item.purchase_order
                  const customerOrder = item.customer_order
                  const customer = customerOrder?.profile
                  const rack = item.warehouse_rack

                  return (
                    <tr key={item.id} className="border-t border-gray-200 hover:bg-gray-50">

                      {/* LOCATION */}
                      <td className="px-6 py-4">
                        {rack ? (
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="font-medium text-gray-800">
                                {rack.rack_id}
                              </p>

                              {rack.name && (
                                <p className="text-xs text-gray-500">
                                  {rack.name}
                                </p>
                              )}

                              {(rack.section || rack.location) && (
                                <p className="text-xs text-gray-400">
                                  {[rack.section, rack.location].filter(Boolean).join(' • ')}
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">
                            No location
                          </span>
                        )}
                      </td>


                      {/* PRODUCT */}
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-800">
                          {product?.product_name || '-'}
                        </p>

                        {product?.brand && (
                          <p className="text-xs text-gray-500">
                            {product.brand}
                          </p>
                        )}
                      </td>


                      {/* QUANTITY */}
                      <td className="px-6 py-4">

                        <span className="font-medium text-gray-800">
                          {item.received_quantity}{' '}
                        </span>

                        {product?.unit && (
                          <span className="font-medium text-gray-800">
                            {product.unit}
                          </span>
                        )}

                      </td>


                      {/* CUSTOMER ORDER */}
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-800">
                          {customerOrder?.order_number || '-'}
                        </p>

                        {purchaseOrder?.po_number && (
                          <p className="text-xs text-gray-500">
                            PO: {purchaseOrder.po_number}
                          </p>
                        )}
                      </td>


                      {/* CUSTOMER */}
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-800">
                          {customer?.name || '-'}
                        </p>

                        {customer?.company && (
                          <p className="text-xs text-gray-500">
                            {customer.company}
                          </p>
                        )}
                      </td>


                      {/* STATUS */}
                      <td className="px-6 py-4">
                        <StatusBadge status={customerOrder?.status}/>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

            </table>
          </div>
        </div>
      )}
    </div>
  )
}