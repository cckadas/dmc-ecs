'use client' // 1548

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { createNotification } from '../services/notificationService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxOpen, faFileLines, faXmark, faImage, faPaperPlane, faPrint } from '@fortawesome/free-solid-svg-icons'

import StatusBadge from '../components/StatusBadge'
import IconButton from '../components/IconButton'


export default function ComplianceLabelSalesPage() {

  const { toast } = useToast()
  const { profile } = useAuth()

  const [customerOrders, setCustomerOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedExchange, setSelectedExchange] = useState(null)
  const [saving, setSaving] = useState(false)


  // =====================================================
  // LOAD CUSTOMER ORDERS
  // =====================================================
  async function loadCustomerOrders() {

    setLoading(true)

    try {

      // =================================================
      // LOAD PURCHASE ORDERS
      // ONLY INCLUDE DELIVERED PURCHASE ORDERS
      // =================================================
      const { data: purchaseOrders, error: purchaseOrderError } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          customer_order_id,
          status,
          created_at,

          customer_orders (
            id,
            order_number,
            customer_id,
            quotation_number,
            total_amount,
            status,
            delivery_location_id
          )
        `)
        .in('status', [
          'fully delivered',
          'partially delivered'
        ])
        .order('created_at', {
          ascending: false
        })

      if (purchaseOrderError) {
        throw purchaseOrderError
      }

      // =================================================
      // ONLY KEEP CUSTOMER ORDERS IN WAREHOUSE PREPARATION
      // =================================================
      const filteredPurchaseOrders = (purchaseOrders || []).filter(
        (po) =>
          po.customer_orders?.status === 'warehouse preparation'
      )

      if (filteredPurchaseOrders.length === 0) {
        setCustomerOrders([])
        return
      }


      // =================================================
      // GET CUSTOMER ORDER IDS
      // =================================================
      const customerOrderIds = [
        ...new Set(
          filteredPurchaseOrders
            .map((po) => po.customer_order_id)
            .filter(Boolean)
        )
      ]

      if (customerOrderIds.length === 0) {
        setCustomerOrders([])
        return
      }


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
      const orderItemIds = (orderItems || [])
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
          filteredPurchaseOrders
            .map(
              (po) =>
                po.customer_orders?.delivery_location_id
            )
            .filter(Boolean)
        )
      ]

      let deliveryLocationsMap = {}

      if (deliveryLocationIds.length > 0) {

        const {
          data: deliveryLocations,
          error: deliveryLocationError
        } = await supabase
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
          filteredPurchaseOrders
            .map(
              (po) =>
                po.customer_orders?.customer_id
            )
            .filter(Boolean)
        )
      ]

      let profilesMap = {}

      if (customerIds.length > 0) {

        const {
          data: profiles,
          error: profileError
        } = await supabase
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
      // MAP PURCHASE ORDERS
      // =================================================
      const purchaseOrdersMap =
        filteredPurchaseOrders.reduce(
          (map, po) => {

            map[po.customer_order_id] = po

            return map
          },
          {}
        )


      // =================================================
      // GROUP ITEMS BY CUSTOMER ORDER
      // =================================================
      const groupedOrders = {}

      ;(orderItems || []).forEach(
        (item) => {

          const customerOrderId =
            item.customer_order_id

          const purchaseOrder =
            purchaseOrdersMap[customerOrderId]

          if (!purchaseOrder) {
            return
          }


          // =================================================
          // CREATE CUSTOMER ORDER GROUP
          // =================================================
          if (!groupedOrders[customerOrderId]) {

            const customerOrder =
              purchaseOrder.customer_orders

            const deliveryLocation =
              deliveryLocationsMap[
                customerOrder?.delivery_location_id
              ] || null

            const customer =
              profilesMap[
                customerOrder?.customer_id
              ] || null


            groupedOrders[customerOrderId] = {

              customer_order: {
                ...customerOrder,
                profile: customer,
                delivery_location: deliveryLocation
              },

              purchase_order: purchaseOrder,

              items: []
            }
          }


          // =================================================
          // ADD ITEM
          // =================================================
          groupedOrders[customerOrderId].items.push({

            ...item,

            compliance_label_exchange:
              exchangesMap[item.id] || null
          })
        }
      )


      // =================================================
      // SET DATA
      // =================================================
      setCustomerOrders(Object.values(groupedOrders))
    }

    catch (error) {
      console.error('Failed to load compliance label orders:', error)
      toast.error(error.message || 'Failed to load compliance label orders.')
    }

    finally {
      setLoading(false)
    }
  }


  // =============================================
  // VIEW LABEL
  // =============================================
  async function viewLabel(path, documentName) {
    if (!path) {
      alert(`${documentName} is not available.`);
      return;
    }

    const { data, error } = await supabase.storage
      .from('compliance-labels')
      .createSignedUrl(path, 60);

    if (error) {
      console.error('Failed to create signed URL:', error);
      alert(`Failed to open ${documentName}.`);
      return;
    }

    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  }


  // =====================================================
  // FORWARD COMPLIANCE DESIGN TO CUSTOMER
  // =====================================================
  async function forwardToCustomer() {

    if (!selectedExchange?.id) {
      toast.error('Missing compliance label exchange.')
      return
    }

    setSaving(true)

    try {

      // =================================================
      // UPDATE COMPLIANCE EXCHANGE STATUS
      // =================================================
      const { error } = await supabase
        .from('compliance_label_exchanges')
        .update({
          status: 'awaiting customer translated design',
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedExchange.id)

      if (error) {
        throw error
      }

      // =============================================
      // GET CUSTOMER ID
      // =============================================
      const { data: customerOrder, error: customerError } = await supabase
        .from('customer_orders')
        .select('customer_id, order_number')
        .eq('id', selectedItem.customer_order_id)
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
        title: `Compliance Label Design Awaiting Translation`,
        message: `DMC has sent a compliance label photo awaiting for your translated design.`,
        type: 'info',
        relatedCustomerOrderId: selectedItem.customer_order_id,
        link: '/compliance-label-customer',
      })

          
      // =================================================
      // SUCCESS
      // =================================================
      toast.success('Compliance design forwarded to customer successfully.')
      closeComplianceModal()
      await loadCustomerOrders()
    }
    
    catch (error) {
      console.error('Failed to forward compliance design to customer:', error)
      toast.error(error.message || 'Failed to forward compliance design to customer.')
    }
    
    finally {
      setSaving(false)
    }
  }


  // =====================================================
  // FORWARD COMPLIANCE DESIGN TO WAREHOUSE
  // =====================================================
  async function confirmLabel() {

    if (!selectedExchange?.id) {
      toast.error('Missing compliance label exchange.')
      return
    }

    setSaving(true)

    try {

      // =================================================
      // UPDATE COMPLIANCE EXCHANGE STATUS
      // =================================================
      const { error } = await supabase
        .from('compliance_label_exchanges')
        .update({
          status: 'printed & awaiting application',
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedExchange.id)

      if (error) {
        throw error
      }

      // =================================================
      // SUCCESS
      // =================================================
      await createNotification({
        userId: profile.id,
        role: 'warehouse',
        title: `Label Printed & Awaiting Application`,
        message: `A customer has uploaded their translated compliance label design and it's ready to be laid out`,
        type: 'info',
        link: '/compliance-label-warehouse',
      })

      toast.success('Printed and forwarded to warehouse.')
      closeComplianceModal()
      await loadCustomerOrders()
    }
    
    catch (error) {
      console.error('Failed to confirm label design:', error)
      toast.error(error.message || 'Failed to confirm label design.')
    }
    
    finally {
      setSaving(false)
    }
  }


  // =====================================================
  // OPEN COMPLIANCE MODAL
  // =====================================================
  function openComplianceModal( order, item ) {
    const exchange = item.compliance_label_exchange || null

    setSelectedOrder(order)
    setSelectedItem(item)
    setSelectedExchange(exchange)
    setShowModal(true)
  }


  // =====================================================
  // CLOSE COMPLIANCE MODAL
  // =====================================================
  function closeComplianceModal() {
    if (saving) { return }

    setShowModal(false)
    setSelectedOrder(null)
    setSelectedItem(null)
    setSelectedExchange(null)
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
          Compliance Labels
        </h1>

        <p className="mt-1 text-gray-500">
          Manage compliance labels for customer orders.
        </p>
      </div>


      {/* =================================================
          LOADING
      ================================================= */}
      {loading ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          Loading customer orders...
        </div>

      ) : customerOrders.length === 0 ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
          <FontAwesomeIcon icon={faBoxOpen} className="mb-3 h-8 w-8 text-gray-300"/>

          <p className="text-sm text-gray-500">
            No customer orders are ready for compliance labeling.
          </p>
        </div>

      ) : (

        <div className="space-y-6">
          {customerOrders.map(
            (orderGroup) => {
              const customerOrder = orderGroup.customer_order
              const purchaseOrder = orderGroup.purchase_order
              const items = orderGroup.items || []
              const exchangeCount = items.filter((item) => item.compliance_label_exchange?.status === 'applied to units').length

              return (
                <div key={customerOrder.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

                  {/* =================================================
                      CUSTOMER ORDER HEADER
                  ================================================= */}
                  <div className="border-b border-gray-200 bg-[#F4F8F5] px-6 py-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-lg font-semibold text-[#1F3A2C]">
                            {customerOrder.order_number || '-'}
                          </h2>

                          <StatusBadge status={customerOrder.status}/>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
                          <span>
                            PO Number:{' '}
                            <span className="font-medium text-gray-700">
                              {purchaseOrder.po_number || '-'}
                            </span>
                          </span>

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


                      {/* =================================================
                          SUMMARY
                      ================================================= */}
                      <div className="flex items-center gap-8">
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Items
                          </p>

                          <p className="mt-1 text-lg font-semibold text-gray-800">
                            {items.length}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Processed
                          </p>

                          <p className="mt-1 text-lg font-semibold text-[#2D5A42]">
                            {exchangeCount}
                            <span className="text-sm font-normal text-gray-400">
                              {' '}/ {items.length}
                            </span>
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
                            Quantity
                          </th>

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Country
                          </th>

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Compliance Status
                          </th>

                          <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Action
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
                                <td className="px-6 py-4 text-left font-medium text-gray-700">
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

                                {/* STATUS */}
                                <td className="px-6 py-4">
                                  {exchange ? (
                                    <StatusBadge status={exchange.status}/>
                                  ) : (
                                    <StatusBadge status="not started"/>
                                  )}
                                </td>

                                {/* ACTION */}
                                <td className="px-6 py-4">
                                  {exchange?.status === 'applied to units' ? (
                                    <span className="text-sm font-medium text-green-600">
                                      Unit is now in staging
                                    </span>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <IconButton
                                        icon={faFileLines}
                                        title={exchange ? 'View / Edit Compliance Label' : 'Process Compliance Label'}
                                        color="amber"
                                        disabled={false}
                                        onClick={() => openComplianceModal(customerOrder, item)}
                                      />
                                    </div>
                                  )}
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


      {/* =====================================================
          COMPLIANCE LABEL MODAL
      ===================================================== */}
      {showModal && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

            {/* =================================================
                MODAL HEADER
            ================================================= */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[#1F3A2C]">
                  Compliance Label
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  {selectedItem.products?.product_name || '-'} {' · '} {selectedOrder?.order_number || '-'}
                </p>
              </div>


              <button
                type="button"
                onClick={closeComplianceModal}
                disabled={saving}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <FontAwesomeIcon icon={faXmark} className="h-5 w-5"/>
              </button>
            </div>


            {/* =================================================
                CONTENT
            ================================================= */}
            <div className="space-y-6 px-6 py-6">

              {/* =================================================
                  ORIGINAL LABEL
              ================================================= */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-gray-800">
                  Original Label
                </h3>

                {selectedExchange?.original_label_path ? (
                  <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <FontAwesomeIcon icon={faImage} className="text-gray-400"/>

                      <span className="text-sm text-gray-600">
                        Existing label uploaded
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => viewLabel(selectedExchange.original_label_path, "Original Label")}
                      className="mt-1 inline-flex rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100"
                    >
                      View Original Label
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <FontAwesomeIcon icon={faImage} className="text-amber-500"/>

                    <div>
                      <p className="text-sm font-medium text-amber-700">
                        Original label not yet available
                      </p>
                      <p className="mt-0.5 text-xs text-amber-600">
                        No orignal label has been uploaded for this exchange yet.
                      </p>
                    </div>
                  </div>
                )}
              </div>


              {/* =================================================
                  CUSTOMER DESIGN
              ================================================= */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-gray-800">
                  Customer Design
                </h3>

                {selectedExchange?.customer_design_path ? (
                  <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <FontAwesomeIcon icon={faImage} className="text-gray-400" />

                      <span className="text-sm text-gray-600">
                        Existing customer design uploaded
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => viewLabel(selectedExchange.customer_design_path, "Customer Design Label") }
                      className="mt-1 inline-flex rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100"
                    >
                      View Customer Design Label
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <FontAwesomeIcon icon={faImage} className="text-amber-500"/>

                    <div>
                      <p className="text-sm font-medium text-amber-700">
                        Customer design not yet available
                      </p>
                      <p className="mt-0.5 text-xs text-amber-600">
                        No customer design has been uploaded for this exchange yet.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>


            {/* =================================================
                MODAL FOOTER
            ================================================= */}
            <div className="flex justify-end gap-3 px-6 py-4">
              <button
                type="button"
                onClick={closeComplianceModal}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={forwardToCustomer}
                disabled={saving || !selectedExchange || selectedExchange.status !== 'original label received'}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPaperPlane} />

                {saving ? 'Sending...' : 'Forward to Customer'}
              </button>

              <button
                type="button"
                onClick={confirmLabel}
                disabled={saving || !selectedExchange || selectedExchange.status !== 'customer design label received'}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2D5A42] px-5 py-2 text-sm font-medium text-white hover:bg-[#234A35] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPrint} />

                {saving ? 'Confirming...' : 'Confirm Label'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}