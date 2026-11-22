'use client' // 1548

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { LABEL_ORDER_STATUSES, arrivedOnly } from '../utils/labelArrival'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { createNotification } from '../services/notificationService'
import { linesShippingNow } from '../services/rushService'
import { casesShipping, casesWaiting } from '../utils/rushLines'
import { faBoxOpen, faFileLines, faUpload, faXmark, faImage, faCheck, faStickyNote } from '@fortawesome/free-solid-svg-icons'

import StatusBadge from '../components/StatusBadge'
import IconButton from '../components/IconButton'
import TableScroll from '../components/TableScroll'
import ListControls from '../components/ListControls'
import { dateTime, exportList, statusText } from '../utils/csvExport'
import { ALL, applySearch, applyShow, applySort, byNewest, byOldest, byStatus, showChoices, showingOf } from '../utils/listControls'
import { LABEL_STAGES, labelStageLabel, labelStageOf } from '../utils/labelStage'
import { LabelHistory } from '../components/HistoryList'


export default function ComplianceLabelWarehouse() {

  const { toast } = useToast()

  const [customerOrders, setCustomerOrders] = useState([])
  // Show (where its labels are), Sort by and Search, above the list.
  const [show, setShow] = useState(ALL)
  const [sortBy, setSortBy] = useState('status')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedExchange, setSelectedExchange] = useState(null)
  const [originalLabelFile, setOriginalLabelFile] = useState(null)
  const [saving, setSaving] = useState(false)


// =====================================================
// LOAD CUSTOMER ORDERS
// =====================================================
async function loadCustomerOrders() {

  setLoading(true)

  try {

    // =================================================
    // LOAD PURCHASE ORDERS
    // Only purchase orders that are fully/partially delivered
    // =================================================
    const {
      data: purchaseOrders,
      error: purchaseOrderError
    } = await supabase
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
        'partially delivered',
        'delivered short'
      ])
      .order('created_at', {
        ascending: false
      })


    if (purchaseOrderError) {
      throw purchaseOrderError
    }


    // =================================================
    // ONLY KEEP PURCHASE ORDERS WHOSE CUSTOMER ORDER
    // IS CURRENTLY IN WAREHOUSE PREPARATION
    // =================================================
    const filteredPurchaseOrders =
      (purchaseOrders || []).filter(
        (po) =>
          LABEL_ORDER_STATUSES.includes(po.customer_orders?.status)
      )


    if (
      filteredPurchaseOrders.length === 0
    ) {
      setCustomerOrders([])
      return
    }


    // =================================================
    // GET CUSTOMER ORDER IDS
    // =================================================
    const customerOrderIds = [
      ...new Set(
        filteredPurchaseOrders
          .map(
            (po) =>
              po.customer_order_id
          )
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
    const {
      data: loadedItems,
      error: orderItemsError
    } = await supabase
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

    // A rushed order: only the lines going in its container.
    // Only products whose goods are in: each moves on as it arrives (049).
    const orderItems = await arrivedOnly(await linesShippingNow(loadedItems))


    // =================================================
    // GET ORDER ITEM IDS
    // =================================================
    const orderItemIds =
      (orderItems || [])
        .map(
          (item) =>
            item.id
        )
        .filter(Boolean)


    // =================================================
    // LOAD COMPLIANCE LABEL EXCHANGES
    // =================================================
    let exchangesMap = {}


    if (orderItemIds.length > 0) {

      const {
        data: exchanges,
        error: exchangesError
      } = await supabase
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


      exchangesMap =
        (exchanges || []).reduce(
          (map, exchange) => {

            map[
              exchange.customer_order_item_id
            ] = exchange

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
              po.customer_orders
                ?.delivery_location_id
          )
          .filter(Boolean)
      )
    ]


    let deliveryLocationsMap = {}


    if (
      deliveryLocationIds.length > 0
    ) {

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


      deliveryLocationsMap =
        (deliveryLocations || []).reduce(
          (map, location) => {

            map[
              location.id
            ] = location

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
              po.customer_orders
                ?.customer_id
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


      profilesMap =
        (profiles || []).reduce(
          (map, profile) => {

            map[
              profile.id
            ] = profile

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

          map[
            po.customer_order_id
          ] = po

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
          purchaseOrdersMap[
            customerOrderId
          ]


        if (!purchaseOrder) {
          return
        }


        // =================================================
        // CREATE CUSTOMER ORDER GROUP
        // =================================================
        if (
          !groupedOrders[
            customerOrderId
          ]
        ) {

          const customerOrder =
            purchaseOrder.customer_orders


          const deliveryLocation =
            deliveryLocationsMap[
              customerOrder
                ?.delivery_location_id
            ] || null


          const customer =
            profilesMap[
              customerOrder
                ?.customer_id
            ] || null


          groupedOrders[
            customerOrderId
          ] = {

            customer_order: {
              ...customerOrder,

              profile:
                customer,

              delivery_location:
                deliveryLocation
            },

            purchase_order:
              purchaseOrder,

            items: []

          }
        }


        // =================================================
        // ADD ITEM
        // =================================================
        groupedOrders[
          customerOrderId
        ].items.push({

          ...item,

          compliance_label_exchange:
            exchangesMap[
              item.id
            ] || null

        })

      }
    )


    // =================================================
    // SET DATA
    // =================================================
    setCustomerOrders(
      Object.values(
        groupedOrders
      )
    )

  }

  catch (error) {

    console.error(
      'Failed to load compliance label orders:',
      error
    )

    toast.error(
      error.message ||
      'Failed to load compliance label orders.'
    )

  }

  finally {

    setLoading(false)

  }
}

  // =====================================================
  // UPLOAD FILE
  // =====================================================
  async function uploadFile( file, folder) {

    if (!file) { return null }

    const extension = file.name.split('.').pop()
    const fileName = `${crypto.randomUUID()}.${extension}`
    const filePath = `${folder}/${fileName}`

    const { error } = await supabase.storage
      .from('compliance-labels')
      .upload(
        filePath,
        file,
        {
          cacheControl: '3600',
          upsert: false
        }
      )

    if (error) {
      throw error
    }

    return filePath
  }


  // =====================================================
  // HANDLE SAVE
  // =====================================================
  async function handleSaveComplianceLabel() {

    if (!selectedItem) { return }

    if (!selectedExchange && !originalLabelFile) {
      toast.error('Please upload at least one file.')
      return
    }

    setSaving(true)

    try {
      let originalLabelPath = selectedExchange?.original_label_path || null
      let customerDesignPath = selectedExchange?.customer_design_path || null

      // =================================================
      // UPLOAD ORIGINAL LABEL
      // =================================================
      if (originalLabelFile) {
        originalLabelPath = await uploadFile(originalLabelFile, 'original-labels')
      }


      // =================================================
      // UPDATE EXISTING EXCHANGE
      // =================================================
      if (selectedExchange) {
        const { error } = await supabase
          .from(
            'compliance_label_exchanges'
          )
          .update({
            original_label_path: originalLabelPath,
            customer_design_path: customerDesignPath,
            status:  'original label received',
            updated_at: new Date().toISOString()
          })
          .eq('id', selectedExchange.id)

        if (error) {
          throw error
        }
      }

      // =================================================
      // CREATE NEW EXCHANGE
      // =================================================
      else {
        const { error } = await supabase
          .from(
            'compliance_label_exchanges'
          )
          .insert({
            customer_order_item_id: selectedItem.id,
            original_label_path: originalLabelPath,
            customer_design_path: customerDesignPath,
            status: 'original label received'
          })

        if (error) {
          throw error
        }
      }


      toast.success('Compliance label saved successfully.')
      closeComplianceModal()
      await loadCustomerOrders()
    }

    catch (error) {
      console.error('Failed to save compliance label:', error)
      toast.error(error.message || 'Failed to save compliance label.')
    }

    finally {
      setSaving(false)
    }
  }


  // =====================================================
  // SEND ITEM TO STAGING
  // =====================================================
  async function sendToStaging(customerOrder, item) {

    if (!item?.id) {
      toast.error('Missing customer order item.')
      return
    }

    const exchange = item.compliance_label_exchange

    if (!exchange?.id) {
      toast.error('No compliance label exchange found for this item.')
      return
    }

    if (!exchange.original_label_path || !exchange.customer_design_path) {
      toast.error('Both the original label and customer design must be uploaded first.')
      return
    }

    setSaving(true)

    try {

      // =================================================
      // UPDATE COMPLIANCE LABEL EXCHANGE
      // =================================================
      const { error: exchangeError } = await supabase
        .from('compliance_label_exchanges')
        .update({
          status: 'applied to units',
          updated_at: new Date().toISOString()
        })
        .eq('id', exchange.id)

      if (exchangeError) {
        throw exchangeError
      }


      // =================================================
      // GET ALL ITEMS FROM THIS CUSTOMER ORDER
      // =================================================
      const { data: loadedItems, error: orderItemsError } = await supabase
        .from('customer_order_items')
        .select(`
          id
        `)
        .eq('customer_order_id', item.customer_order_id)

      if (orderItemsError) {
        throw orderItemsError
      }

      // A rushed order is ready once the lines going in its container are.
      const orderItems = await linesShippingNow(loadedItems)


      // =================================================
      // GET ALL COMPLIANCE EXCHANGES
      // FOR THIS CUSTOMER ORDER
      // =================================================
      const orderItemIds = (orderItems || [])
        .map((orderItem) => orderItem.id)
        .filter(Boolean)


      let exchanges = []

      if (orderItemIds.length > 0) {
        const { data: exchangeData, error: exchangesError } = await supabase
          .from('compliance_label_exchanges')
          .select(`
            id,
            customer_order_item_id,
            status
          `)
          .in('customer_order_item_id', orderItemIds)

        if (exchangesError) {
          throw exchangesError
        }

        exchanges = exchangeData || []
      }


      // =================================================
      // CHECK IF ALL ITEMS ARE APPLIED TO UNITS
      // =================================================
      const allItemsApplied = orderItems && orderItems.length > 0 && orderItems.every(
          (orderItem) => {
            const orderItemExchange = exchanges.find((exchange) => exchange.customer_order_item_id ===orderItem.id)
            return ( orderItemExchange?.status === 'applied to units')
          }
        )


      // =================================================
      // UPDATE CUSTOMER ORDER STATUS
      // =================================================
      if (allItemsApplied) {
        const { error: customerOrderError } = await supabase
          .from('customer_orders')
          .update({
            status: 'ready for shipment'
          })
          .eq('id', item.customer_order_id)

        if (customerOrderError) {
          throw customerOrderError
        }

        const { error: historyError } = await supabase
          .from('customer_order_status_history')
          .insert({
            customer_order_id: item.customer_order_id,
            previous_status: 'warehouse preparation',
            new_status: 'ready for shipment',
            changed_at: new Date().toISOString()
          })

        if (historyError) {
          throw historyError
        }


        await createNotification({
          userId: customerOrder.customer_id,
          role: 'customer',
          title: `${customerOrder.order_number} is ready for shipment`,
          message: `Your order ${customerOrder.order_number} status is now "Ready for Shipment". Please check your order details for more information.`,
          type: 'info',
          relatedCustomerOrderId: customerOrder.id,
          link: '/my-orders',
        })

        toast.success('All items are ready. Customer order sent to shipment.')
      }
      
      else {
        toast.success('Compliance label applied to units successfully.')
      }

      await loadCustomerOrders()

    }

    catch (error) {
      console.error('Failed to send item to staging:',error)
      toast.error(error.message || 'Failed to send item to staging.')
    }

    finally {
      setSaving(false)
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
  // OPEN COMPLIANCE MODAL
  // =====================================================
  function openComplianceModal( order, item ) {
    const exchange = item.compliance_label_exchange || null

    setSelectedOrder(order)
    setSelectedItem(item)
    setSelectedExchange(exchange)
    setOriginalLabelFile(null)
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
    setOriginalLabelFile(null)
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    loadCustomerOrders()
  }, [])


  // The list as chosen above it: each order by its least advanced label.
  const stageOf = (group) => labelStageOf(group.items)
  const labelList = { statusOf: stageOf, order: LABEL_STAGES, labelOf: (stage) => labelStageLabel(stage, { forCustomer: false }), allLabel: 'All orders' }
  const choices = showChoices(customerOrders, labelList)
  const showing = showingOf(choices, show)
  const shownGroups = applySort(
    applySearch(applyShow(customerOrders, showing, labelList), search, (group) => [group.customer_order?.order_number, group.customer_order?.quotation_number, group.customer_order?.profile?.name, group.customer_order?.profile?.company, ...(group.items || []).map((item) => item.products?.product_name)].join(' ')),
    sortBy,
    {
      status: byStatus(stageOf, LABEL_STAGES, (group) => group.customer_order?.created_at),
      newest: byNewest((group) => group.customer_order?.created_at),
      oldest: byOldest((group) => group.customer_order?.created_at),
    }
  )


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


      <ListControls
        choices={choices}
        show={showing}
        onShow={setShow}
        sorts={[
          { value: 'status', label: 'Status (least advanced first)' },
          { value: 'newest', label: 'Newest first' },
          { value: 'oldest', label: 'Oldest first' },
        ]}
        sortBy={sortBy}
        onSort={setSortBy}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Order number, customer, product"
        shown={shownGroups.length}
        total={customerOrders.length}
        onExport={(how) => exportList(how, 'compliance-labels', LABEL_COLUMNS, shownGroups.flatMap((group) => (group.items || []).map((item) => ({ group, item }))))}
        noun={customerOrders.length === 1 ? 'order' : 'orders'}
        loading={loading}
      />


      {/* =================================================
          LOADING
      ================================================= */}
      {loading ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          Loading customer orders...
        </div>

      ) : shownGroups.length === 0 ? (

        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
          <FontAwesomeIcon icon={faBoxOpen} className="mb-3 h-8 w-8 text-gray-300"/>

          <p className="text-sm text-gray-500">
            {customerOrders.length > 0 ? 'Nothing matches what is chosen above.' : 'No customer orders are ready for compliance labeling.'}
          </p>
        </div>

      ) : (

        <div className="space-y-6">
          {shownGroups.map(
            (orderGroup) => {
              const customerOrder = orderGroup.customer_order
              const purchaseOrder = orderGroup.purchase_order
              const items = orderGroup.items || []
              const exchangeCount = items.filter((item) => item.compliance_label_exchange?.status === 'applied to units').length

              return (
                <div key={customerOrder.id} className="overflow-clip rounded-xl border border-gray-200 bg-white shadow-sm">

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

                                {/* QUANTITY: a rushed order's cases going in this container */}
                                <td className="px-6 py-4 text-left font-medium text-gray-700">
                                  {casesShipping(item)}
                                  {item.products?.unit && (
                                    <span className="ml-1 text-xs text-gray-500">
                                      {item.products.unit}
                                    </span>
                                  )}
                                  {casesWaiting(item) > 0 && (
                                    <span className="mt-0.5 block text-xs font-normal text-amber-700">
                                      of {item.quantity}: the rest wait for the customer's next order
                                    </span>
                                  )}
                                  {item.carried_from_item_id && (
                                    <span className="mt-0.5 block text-xs font-normal text-amber-700">
                                      Waited from an earlier order (rush shipment)
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

                                      <IconButton
                                        icon={faStickyNote}
                                        title={item.arrival?.complete === false ? `${item.arrival.received} of ${item.arrival.ordered} cases are in: its labels are applied once all of them are` : 'Label Applied to Units'}
                                        color="blue"
                                        disabled={ !exchange?.original_label_path || !exchange?.customer_design_path || exchange.status !== 'printed & awaiting application' || item.arrival?.complete === false}
                                        onClick={() => sendToStaging(customerOrder,item)}
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
                  </TableScroll>
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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">

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

                {selectedExchange?.original_label_path && (
                  <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <FontAwesomeIcon icon={faImage} className="text-gray-400"/>

                      <span className="text-sm text-gray-600">
                        Existing original label uploaded
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
                )}

                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center transition hover:border-[#2D5A42] hover:bg-[#F4F8F5]">
                  <FontAwesomeIcon icon={faUpload} className="mb-3 h-6 w-6 text-gray-400"/>

                  <p className="text-sm font-medium text-gray-700">
                    {originalLabelFile ? originalLabelFile.name : 'Upload original label photo'}
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    PNG, JPG, JPEG
                  </p>

                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      setOriginalLabelFile(file)
                    }}
                  />
                </label>
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


              {/* =================================================
                  HISTORY (each step's date and time)
              ================================================= */}
              <LabelHistory exchangeId={selectedExchange?.id}/>
            </div>


            {/* =================================================
                MODAL FOOTER
            ================================================= */}
            <div className="flex justify-end gap-3 px-6 py-4">
              <button
                type="button"
                onClick={closeComplianceModal}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveComplianceLabel}
                disabled={saving || !originalLabelFile || (selectedExchange && (selectedExchange.status === 'awaiting customer translated design' || selectedExchange.status === 'printed & awaiting application'))}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2D5A42] px-5 py-2 text-sm font-medium text-white hover:bg-[#234A35] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faCheck}/>
                {saving ? 'Saving...' : 'Save Compliance Label'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per product, as listed (a rushed order: only what ships now).
// =============================================
const LABEL_COLUMNS = [
  { header: 'Order', value: ({ group }) => group.customer_order?.order_number },
  { header: 'Quotation', value: ({ group }) => group.customer_order?.quotation_number },
  { header: 'Company', value: ({ group }) => group.customer_order?.profile?.company || group.customer_order?.profile?.name },
  { header: 'Country', value: ({ group }) => group.customer_order?.delivery_location?.country },
  { header: 'Order status', value: ({ group }) => statusText(group.customer_order?.status) },
  { header: 'Product', value: ({ item }) => item.products?.product_name },
  { header: 'Brand', value: ({ item }) => item.products?.brand },
  { header: 'Cases', value: ({ item }) => casesShipping(item) },
  { header: 'Unit', value: ({ item }) => item.products?.unit },
  { header: 'Label status', value: ({ item }) => statusText(item.compliance_label_exchange?.status) || 'Not started' },
  { header: 'Label updated', value: ({ item }) => dateTime(item.compliance_label_exchange?.updated_at) },
]
