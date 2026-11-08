'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { createNotification } from '../services/notificationService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxOpen, faPaperPlane, faTruckRampBox } from '@fortawesome/free-solid-svg-icons'
import { generatePackingList } from '../services/packingListService'
import { generateCertificateOfShipment, generateCertificateOfClearance } from '../services/certificateService'

import StatusBadge from '../components/StatusBadge'
import TableScroll from '../components/TableScroll'


const formatLoadedAt = (value) =>
  new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })


// The racks holding each order's goods, by order and product:
// { 'orderId:productId': ['RACK-001', ...] }. Staff see where to load from,
// and which racks loading frees.
async function loadRacksByProduct(customerOrderIds) {
  const { data: purchaseOrders, error: poError } = await supabase
    .from('purchase_orders')
    .select('id, customer_order_id')
    .in('customer_order_id', customerOrderIds)

  if (poError) {
    throw poError
  }

  const orderOfPo = Object.fromEntries((purchaseOrders || []).map((po) => [po.id, po.customer_order_id]))
  const poIds = Object.keys(orderOfPo)
  if (!poIds.length) return {}

  const { data: lines, error: linesError } = await supabase
    .from('purchase_order_items')
    .select('id, purchase_order_id, product_id, warehouse_rack_id')
    .in('purchase_order_id', poIds)

  if (linesError) {
    throw linesError
  }

  const lineIds = (lines || []).map((line) => line.id)
  const [links, racks] = await Promise.all([
    lineIds.length
      ? supabase.from('purchase_order_item_racks').select('purchase_order_item_id, warehouse_rack_id').in('purchase_order_item_id', lineIds)
      : Promise.resolve({ data: [] }),
    supabase.from('warehouse_racks').select('id, rack_id'),
  ])

  if (links.error) throw links.error
  if (racks.error) throw racks.error

  const rackName = Object.fromEntries((racks.data || []).map((rack) => [rack.id, rack.rack_id]))
  const lineById = Object.fromEntries((lines || []).map((line) => [line.id, line]))
  const byProduct = {}
  const add = (line, rackId) => {
    const key = `${orderOfPo[line.purchase_order_id]}:${line.product_id}`
    byProduct[key] = [...new Set([...(byProduct[key] || []), rackName[rackId] || 'a rack'])]
  }

  for (const link of links.data || []) {
    if (lineById[link.purchase_order_item_id]) add(lineById[link.purchase_order_item_id], link.warehouse_rack_id)
  }
  for (const line of lines || []) {
    if (line.warehouse_rack_id) add(line, line.warehouse_rack_id)
  }

  return byProduct
}


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
          loaded_at,

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
      // WHERE EACH PRODUCT'S GOODS ARE
      // =================================================
      const racksByProduct = await loadRacksByProduct(customerOrderIds)


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
          compliance_label_exchange: exchange,
          racks: racksByProduct[`${item.customer_order_id}:${item.product_id}`] || [],
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
  // =====================================================
  // MARK GOODS AS LOADED INTO THE CONTAINER
  // =====================================================
  // Loading frees the racks those goods were in, for the next delivery,
  // without waiting for the order to ship. It only frees space: shipping
  // works as before (db/migrations/022).
  async function loadItems(order, items) {
    const toLoad = items.filter((item) => !item.loaded_at)
    if (!order?.id || !toLoad.length) return

    const racks = [...new Set(toLoad.flatMap((item) => item.racks || []))]
    const what = toLoad.length === 1 ? (toLoad[0].products?.product_name || 'this product') : `${toLoad.length} products`
    const freeing = racks.length ? ` This frees ${racks.join(', ')} for new deliveries.` : ''

    if (!window.confirm(`Mark ${what} as loaded into the container?${freeing}`)) return

    setLoading(true)

    try {
      const { data, error } = await supabase.rpc('load_order_items', {
        p_customer_order_id: order.id,
        p_item_ids: toLoad.map((item) => item.id),
      })

      if (error) {
        throw error
      }

      const freed = data?.[0]?.racks_freed ?? 0
      toast.success(`Marked as loaded.${freed ? ` ${freed} ${freed === 1 ? 'rack' : 'racks'} freed.` : ''}`)
      await loadCustomerOrders()
    }

    catch (error) {
      console.error('Failed to mark goods as loaded:', error)
      toast.error(error.message || 'Failed to mark goods as loaded.')
    }

    finally {
      setLoading(false)
    }
  }


  async function markOrderAsShipped(order) {

    if (!order?.id) {
      toast.error('Missing customer order.')
      return
    }

    setLoading(true)

    try {

      // =================================================
      // CHECK IT CAN SHIP, BEFORE MAKING ITS DOCUMENTS
      // =================================================
      // Every item's labels applied, and not shipped already, checked now
      // rather than when the page loaded (db/migrations/021).
      const { error: checkError } = await supabase.rpc('ship_customer_order', {
        p_customer_order_id: order.id,
        p_check_only: true,
      })

      if (checkError) {
        throw checkError
      }


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
      // GET PURCHASE ORDER ITEMS
      // =================================================
      let purchaseOrderItems = []

      if (purchaseOrderIds.length > 0) {
        const { data: items, error: itemsError } = await supabase
          .from('purchase_order_items')
          .select(`
            id,
            warehouse_rack_id,
            product_id,
            ordered_quantity,
            received_quantity,
            product:products (
              product_name,
              sku,
              unit
            )
          `)
          .in('purchase_order_id', purchaseOrderIds)

        if (itemsError) {
          throw itemsError
        }

        purchaseOrderItems = items || []
      }


      // =================================================
      // GENERATE AND UPLOAD PACKING LIST
      // =================================================
      if (purchaseOrderItems.length === 0) {
        throw new Error('No purchase order items found for packing list.')
      }

      // Get customer order number and current status
      const { data: packingOrder, error: packingOrderError } = await supabase
        .from('customer_orders')
        .select('id, order_number, status')
        .eq('id', order.id)
        .single()

      if (packingOrderError) {
        throw packingOrderError
      }

      // Generate packing list PDF
      const packingList = generatePackingList(
        packingOrder,
        purchaseOrderItems
      )

      const pdfBlob = packingList.output('blob')

      // Create storage path
      const safeOrderNumberA = String(packingOrder.order_number)
        .replace(/[^a-zA-Z0-9_-]/g, '_')

      const filePath = `packing-lists/${safeOrderNumberA}-PL.pdf`

      // Upload PDF to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (uploadError) {
        throw uploadError
      }

      // Save packing list path to customer order
      const { error: pathError } = await supabase
        .from('customer_orders')
        .update({
          pack_list_path: filePath,
        })
        .eq('id', order.id)

      if (pathError) {
        throw pathError
      }


      // =================================================
      // GENERATE AND UPLOAD CERTIFICATE OF SHIPMENT
      // =================================================
      const certificate = generateCertificateOfShipment(
        packingOrder,
        purchaseOrderItems
      )

      const certificateBlob = certificate.output('blob')

      const safeOrderNumberB = String(packingOrder.order_number)
        .replace(/[^a-zA-Z0-9_-]/g, '_')

      const certificatePath =
        `certificates/${safeOrderNumberB}-Certificate-of-Shipment.pdf`

      // Upload certificate
      const { error: certificateUploadError } = await supabase.storage
        .from('documents')
        .upload(certificatePath, certificateBlob, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (certificateUploadError) {
        throw certificateUploadError
      }

      // Save certificate path to customer order
      const { error: certificatePathError } = await supabase
        .from('customer_orders')
        .update({
          cert_shipment_path: certificatePath,
        })
        .eq('id', order.id)

      if (certificatePathError) {
        throw certificatePathError
      }



      // =================================================
      // GENERATE AND UPLOAD CERTIFICATE OF CLEARANCE
      // =================================================
      const clearancePdf = generateCertificateOfClearance(
        packingOrder,
        purchaseOrderItems
      )

      const clearanceBlob = clearancePdf.output('blob')

      const safeOrderNumberC = String(
        packingOrder.order_number || order.id
      ).replace(/[^a-zA-Z0-9_-]/g, '_')

      const clearancePath =
        `certificates/${safeOrderNumberC}-Certificate-of-Clearance.pdf`

      // Upload PDF
      const { error: clearanceUploadError } = await supabase.storage
        .from('documents')
        .upload(clearancePath, clearanceBlob, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (clearanceUploadError) {
        throw clearanceUploadError
      }

      // Save path to customer order
      const { error: clearancePathError } = await supabase
        .from('customer_orders')
        .update({
          cert_clearance_path: clearancePath,
        })
        .eq('id', order.id)

      if (clearancePathError) {
        throw clearancePathError
      }

      // =================================================
      // SHIP IT, IN ONE STEP
      // =================================================
      // The database checks again, then frees the racks, marks the order
      // shipped today (its real ship date, which the estimates learn from) and
      // records it, all or nothing. A second click is refused, so nothing is
      // done twice (db/migrations/021).
      const { data: shippedRows, error: shipError } = await supabase.rpc('ship_customer_order', {
        p_customer_order_id: order.id,
      })

      if (shipError) {
        throw shipError
      }

      const shipped = shippedRows?.[0] || {}
      toast.success('Customer order marked as shipped successfully.')


      // =============================================
      // TELL THE CUSTOMER
      // =============================================
      // It's shipped either way: a failed notification is reported, not retried.
      try {
        await createNotification({
          userId: shipped.customer_id,
          role: 'customer',
          title: `${shipped.order_number} is shipped`,
          message: `Your order ${shipped.order_number} status is now "Shipped". Please check your order details for more information.`,
          type: 'info',
          relatedCustomerOrderId: order.id,
          link: '/my-orders',
        })
      } catch (notifyError) {
        console.error('Failed to notify the customer:', notifyError)
        toast.error('Shipped, but the customer could not be notified.')
      }

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
                <div key={customerOrder.id} className="overflow-clip rounded-xl border border-gray-200 bg-white shadow-sm">

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
                          SUMMARY + MARK AS SHIPPED
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


                        {/* LOAD ALL BUTTON */}
                        <button
                          type="button"
                          disabled={loading || items.every((item) => item.loaded_at)}
                          onClick={() => loadItems(customerOrder, items)}
                          className="inline-flex items-center gap-2 rounded-lg border border-[#2D5A42] bg-white px-4 py-2 text-sm font-medium text-[#2D5A42] transition hover:bg-[#F4F8F5] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <FontAwesomeIcon icon={faTruckRampBox} className="h-4 w-4"/>

                          {items.every((item) => item.loaded_at) ? 'All loaded' : 'Load all'}
                        </button>


                        {/* MARK AS SHIPPED BUTTON */}
                        <button
                          type="button"
                          disabled={loading || items.length < Number(orderGroup.total_items)}
                          onClick={() => markOrderAsShipped(customerOrder)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#234A35] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <FontAwesomeIcon icon={faPaperPlane} className="h-4 w-4"/>

                          Mark as Shipped
                        </button>

                      </div>
                    </div>
                  </div>


                  {/* =================================================
                      ITEMS TABLE
                  ================================================= */}
                  <TableScroll>
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

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Racks
                          </th>

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Container
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

                                {/* RACKS: where to load from, until loading frees them */}
                                <td className="px-6 py-4 text-sm text-gray-700">
                                  {item.loaded_at
                                    ? <span className="text-gray-400">Freed</span>
                                    : item.racks?.length
                                      ? item.racks.join(', ')
                                      : <span className="text-gray-400">-</span>}
                                </td>

                                {/* CONTAINER */}
                                <td className="px-6 py-4">
                                  {item.loaded_at ? (
                                    <span className="text-sm font-medium text-green-700">
                                      Loaded {formatLoadedAt(item.loaded_at)}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => loadItems(customerOrder, [item])}
                                      className="rounded-md border border-[#2D5A42] px-3 py-1 text-xs font-medium text-[#2D5A42] transition hover:bg-[#F4F8F5] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Mark loaded
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          }
                        )}
                      </tbody>

                    </table>
                  </TableScroll>
                </div>
              )
            }
          )}
        </div>
      )}
    </div>
  )
}