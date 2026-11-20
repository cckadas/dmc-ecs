'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faTruckFast, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"
import StatusBadge from '../components/StatusBadge'
import OrderProgress from '../components/OrderProgress'

import IconButton from '../components/IconButton'
import TableScroll from '../components/TableScroll'
import ShipDateSummary from '../components/ShipDateSummary'
import LabelDesignsNote from '../components/LabelDesignsNote'
import DownPaymentDeadline from '../components/DownPaymentDeadline'
import { CANCELLATION_COLUMNS, RUSH_ITEM_COLUMNS, columnsIf, withNewColumns } from '../utils/newColumns'
import { RushAgreement, RushShipmentModal, WaitingGoods } from '../components/RushShipment'
import { loadMyRushOptions, loadRushAgreements, loadWaitingGoods, stillToShip } from '../services/rushService'
import { lineNote, orderNumberByItem } from '../utils/rushLines'
import { loadMyEstimates } from '../services/predictionService'
import ListControls from '../components/ListControls'
import { dateTime, day, downloadCsv, exportName, money, productsText, statusText } from '../utils/csvExport'
import { ALL, applySearch, applyShow, applySort, byNewest, byOldest, byStatus, showChoices, showingOf } from '../utils/listControls'
import { STATUS_ORDER } from '../utils/orderStatusSort'


export default function MyOrdersPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [orders, setOrders] = useState([])
  // Show (a status), Sort by and Search, above the list.
  const [show, setShow] = useState(ALL)
  const [sortBy, setSortBy] = useState('status')
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  // Each order's estimated ship date, from DMC's server, by order id.
  const [estimates, setEstimates] = useState({})
  // Rush shipments (db/migrations/034): the orders that can be rushed now, the
  // agreements, and the goods waiting for the next order.
  const [rushOptions, setRushOptions] = useState(new Map())
  const [agreements, setAgreements] = useState(new Map())
  const [waitingRows, setWaitingRows] = useState([])
  const [rushing, setRushing] = useState(null)


  // =============================================
  // LOAD MY ORDERS
  // =============================================
  async function loadMyOrders() {

    if (!profile?.id) {
      return
    }

    setLoading(true)

    // When and why an order was cancelled (028), and what a rush shipment
    // split (034): asked again without them until those scripts are run.
    const { data, error } = await withNewColumns((withRush) => withNewColumns((withCancellation) => supabase
      .from('customer_orders')
      .select(`
        id,
        order_number,
        quotation_number,
        subtotal,
        container_size,
        container_cost,
        shipping_cost,
        estimated_ship_date,
        requested_ship_date,
        delivery_location_id,
        total_amount,
        down_payment_amount,
        status,
        settled_amount,
        pending_payment_amount,
        expiry_date,
        ${columnsIf(withCancellation, CANCELLATION_COLUMNS)}
        payment_proof_dp,
        payment_proof_complete,
        pfi_file_path,
        created_at,

        customer_order_items (
          id,
          product_id,
          quantity,
          unit_price,
          subtotal,
          ${columnsIf(withRush, RUSH_ITEM_COLUMNS)}

          products (
            product_name,
            brand,
            unit
          ),

          compliance_label_exchanges (
            status
          )
        )
      `)
      .eq('customer_id', profile.id)
      .order('created_at', {
        ascending: false,
      }), CANCELLATION_COLUMNS), RUSH_ITEM_COLUMNS)

    if (error) {
      toast.error('Failed to load your orders.')
      setLoading(false)
      return
    }

    setOrders(data || [])
    setLoading(false)

    // Not needed to show the orders: a failure just leaves the rush parts out.
    loadRushParts(data || []).catch((rushError) => console.error('Failed to load rush shipments:', rushError))
  }


  // What can be rushed, what was agreed, and what waits for the next order.
  async function loadRushParts(list) {
    const [options, agreed, waiting] = await Promise.all([
      loadMyRushOptions(),
      loadRushAgreements(list.map((order) => order.id)),
      loadWaitingGoods(profile.id),
    ])
    setRushOptions(options)
    setAgreements(agreed)
    setWaitingRows(waiting)
  }


  // =============================================
  // OPEN ORDER MODAL
  // =============================================
  function openOrderModal(order) {
    setSelectedOrder(order)
    setShowModal(true)
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadMyOrders()

      // Not needed to show the orders, so a failure just leaves the dates out.
      loadMyEstimates()
        .then(setEstimates)
        .catch((error) => console.error('Failed to load ship date estimates:', error))
    }
  }, [profile?.id])


  // =============================================
  // MAIN CONTENT
  // =============================================
  const orderList = { statusOf: (order) => order.status, order: STATUS_ORDER, allLabel: 'All orders' }
  const choices = showChoices(orders, orderList)
  const showing = showingOf(choices, show)
  const shownOrders = applySort(
    applySearch(applyShow(orders, showing, orderList), search, (order) => [order.order_number, order.quotation_number].join(' ')),
    sortBy,
    {
      status: byStatus((order) => order.status, STATUS_ORDER, (order) => order.created_at),
      newest: byNewest((order) => order.created_at),
      oldest: byOldest((order) => order.created_at),
    }
  )

  return (
    <div>

      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#1F3A2C]">
          My Orders
        </h1>

        <p className="mt-1 text-gray-500">
          Track your orders and see where each one is in the process.
        </p>
      </div>

      <WaitingGoods rows={waitingRows} />


      <ListControls
        choices={choices}
        show={showing}
        onShow={setShow}
        sorts={[
          { value: 'status', label: 'Status (the order\'s steps, newest first in each)' },
          { value: 'newest', label: 'Newest first' },
          { value: 'oldest', label: 'Oldest first' },
        ]}
        sortBy={sortBy}
        onSort={setSortBy}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Order or quotation number"
        shown={shownOrders.length}
        total={orders.length}
        onExport={() => downloadCsv(exportName('my-orders'), myOrderColumns(estimates), shownOrders)}
        noun={orders.length === 1 ? 'order' : 'orders'}
        loading={loading}
      />


      {/* TABLE */}
      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">

          {/* TABLE HEADER */}
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Order Number
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Quotation
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Total
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Ship Date
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Action
              </th>
            </tr>
          </thead>


          {/* TABLE BODY */}
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan="6"
                  className="py-10 text-center text-sm text-gray-500"
                >
                  Loading your orders...
                </td>
              </tr>

            ) : shownOrders.length > 0 ? (
              shownOrders.map((order) => (
                <tr
                  key={order.id}
                  className="border-t border-gray-200 text-sm hover:bg-gray-50"
                >

                  {/* ORDER NUMBER */}
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {order.order_number || '-'}
                  </td>


                  {/* QUOTATION */}
                  <td className="px-5 py-3">
                    {order.quotation_number || '-'}
                  </td>


                  {/* TOTAL */}
                  <td className="px-5 py-3 font-medium">
                    ₱ {Number(order.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>


                  {/* STATUS */}
                  <td className="px-5 py-3">
                    <StatusBadge status={order.status}/>
                    <DownPaymentDeadline order={order} className="mt-1 max-w-[16rem]" />
                    <RushNote option={rushOptions.get(order.id)} waiting={stillToShip(waitingRows.filter((row) => row.customer_order_id === order.id))} agreed={agreements.has(order.id)} />
                  </td>


                  {/* DATE */}
                  <td className="px-5 py-3">
                    <ShipDateSummary estimate={estimates[order.id]} />
                    <LabelDesignsNote order={order} compact />
                  </td>


                  {/* ACTION */}
                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <IconButton icon={faFolderOpen} title="View Order" color="blue" disabled={false} onClick={() => openOrderModal(order)}/>
                      {rushOptions.has(order.id) && (
                        <IconButton icon={faTruckFast} title="Rush shipment: ship what's in now" color="green" disabled={false} onClick={() => setRushing(order)}/>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="py-10 text-center text-sm text-gray-500">
                  {orders.length > 0 ? 'Nothing matches what is chosen above.' : 'You have no customer orders.'}
                </td>
              </tr>

            )}
          </tbody>
        </table>
      </TableScroll>


      {/* MODAL */}
      {showModal && selectedOrder && (
        <MyOrderModal
          order={selectedOrder}
          estimate={estimates[selectedOrder.id]}
          rushOption={rushOptions.get(selectedOrder.id)}
          agreement={agreements.get(selectedOrder.id)}
          waiting={waitingRows.filter((row) => row.customer_order_id === selectedOrder.id)}
          fromOrder={orderNumberByItem(orders)}
          onRush={() => setRushing(selectedOrder)}
          onClose={() => {
            setShowModal(false)
            setSelectedOrder(null)
          }}
        />
      )}

      {/* The rush shipment: what ships, what waits, and agreeing */}
      {rushing && (
        <RushShipmentModal
          order={rushing}
          onClose={() => setRushing(null)}
          onAgreed={async () => {
            setShowModal(false)
            setSelectedOrder(null)
            await loadMyOrders()
          }}
        />
      )}

    </div>
  )
}



// =====================================================
// VIEW CUSTOMER ORDER MODAL
// =====================================================
function MyOrderModal({ order, estimate, rushOption = null, agreement = null, waiting = [], fromOrder = new Map(), onRush, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {order.order_number}
            </h2>

            <p className="text-sm text-gray-500">
              My Order
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

          <LabelDesignsNote order={order} />

          <OrderProgress order={order}/>

          {/* A rush shipment: agreed, or one the customer can ask for now */}
          <RushAgreement agreement={agreement} waiting={waiting} />

          {!agreement && rushOption && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
              <p className="font-semibold text-gray-800">
                <FontAwesomeIcon icon={faTruckFast} className="mr-2 text-[#2D5A42]" />
                Want what's here shipped now?
              </p>
              <p className="mt-1 text-gray-700">
                {rushOption.casesNow.toLocaleString()} of {(rushOption.casesNow + rushOption.casesWaiting).toLocaleString()} cases of this order are in
                DMC's warehouse. You can ask for a rush shipment: what's here ships now, and the rest goes in the container of your next order.
              </p>
              <button
                type="button"
                onClick={onRush}
                className="mt-3 rounded-md bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633]"
              >
                Rush shipment...
              </button>
            </div>
          )}



          {/* =================================================
              ORDER INFORMATION
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Order Information
          </h3>

          <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500"> Order Number </p>
              <p className="mt-1 font-medium text-gray-800"> {order.order_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Quotation Number </p>
              <p className="mt-1 font-medium text-gray-800"> {order.quotation_number || '-'} </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Status </p>
              <p className="mt-1 font-medium text-gray-800"> <StatusBadge status={order.status}/> </p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-500"> Estimated Ship Date </p>
              <div className="mt-1">
                <ShipDateSummary estimate={estimate} />
              </div>
            </div>
          </div>


          {/* =================================================
              ITEMS
          ================================================= */}
          <h3 className="mb-3 text-sm font-semibold text-gray-800">
            Order Items
          </h3>

          <TableScroll className="rounded-lg border">
            <table className=" min-w-full">

              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Product
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Brand
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Quantity
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Unit
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Unit Price
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                    Subtotal
                  </th>
                </tr>
              </thead>

              <tbody>
                {order.customer_order_items.map((item) => (
                  <tr key={item.id} className="border-t border-gray-200">

                    {/* PRODUCT */}
                    <td className="px-4 py-4">
                      {item.products?.product_name || '-'}
                      {lineNote(item, fromOrder.get(item.carried_from_item_id)) && (
                        <span className="mt-0.5 block text-xs text-amber-700">{lineNote(item, fromOrder.get(item.carried_from_item_id))}</span>
                      )}
                    </td>


                    {/* BRAND */}
                    <td className="px-4 py-4">
                      {item.products?.brand || '-'}
                    </td>


                    {/* QUANTITY */}
                    <td className="px-4 py-4 text-left">
                      {item.quantity}
                    </td>


                    {/* UNIT */}
                    <td className="px-4 py-4">
                      {item.products?.unit || '-'}
                    </td>


                    {/* UNIT PRICE */}
                    <td className="px-4 py-4 text-left">
                      ₱ {Number(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>


                    {/* SUBTOTAL */}
                    <td className="px-4 py-4 text-left">
                      ₱ {Number(item.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>
          </TableScroll>


          {/* =================================================
              SUMMARY
          ================================================= */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-sm">

              <h3 className="mb-3 text-sm font-semibold text-gray-800">
                Order Summary
              </h3>

              <div className="rounded-lg bg-gray-50 p-5">
                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Subtotal
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.subtotal || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2
                    })}
                  </span>
                </div>

                {order.container_cost != null && (
                  <div className="mb-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-700">
                      Container ({order.container_size})
                    </span>

                    <span className="text-lg font-bold text-gray-800">
                      ₱ {Number(order.container_cost).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>
                )}

                <div className="mb-3 flex justify-between text-sm">
                  <span className="font-semibold text-gray-700">
                    Shipping Cost
                  </span>

                  <span className="text-lg font-bold text-gray-800">
                    ₱ {Number(order.shipping_cost || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2
                    })}
                  </span>
                </div>

                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">
                      Total
                    </span>

                    <span className="text-xl font-bold text-gray-800">
                      ₱ {Number(order.total_amount || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="font-semibold text-green-700">
                      Down Payment
                    </span>

                    <span className="text-lg font-bold text-green-800">
                      ₱ {Number(order.down_payment_amount || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </span>
                  </div>
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
            Close
          </button>
        </div>

      </div>
    </div>
  )
}


// Under an order's status: it can be rushed, or how much of it waits.
function RushNote({ option, waiting, agreed }) {
  if (option) {
    return (
      <p className="mt-1 max-w-[16rem] text-xs text-green-700">
        {option.casesNow.toLocaleString()} of {(option.casesNow + option.casesWaiting).toLocaleString()} cases are in: you can rush what's here.
      </p>
    )
  }

  if (!agreed || !waiting.length) return null

  // Still waiting for an order, or already joined to one not shipped yet.
  const cases = (rows) => rows.reduce((sum, row) => sum + Number(row.cases || 0), 0)
  const notTaken = cases(waiting.filter((row) => !row.carried_into))
  const joined = [...new Set(waiting.filter((row) => row.carried_into).map((row) => row.carried_into))]
  const taken = cases(waiting.filter((row) => row.carried_into))
  return (
    <p className="mt-1 max-w-[16rem] text-xs text-amber-700">
      Rush shipment:
      {notTaken > 0 && ` ${notTaken.toLocaleString()} ${notTaken === 1 ? 'case waits' : 'cases wait'} for your next order`}
      {notTaken > 0 && taken > 0 && ';'}
      {taken > 0 && ` ${taken.toLocaleString()} ${taken === 1 ? 'case goes' : 'cases go'} with ${joined.join(', ')}`}.
    </p>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per order, as listed, with its ship date estimate.
// =============================================
const myOrderColumns = (estimates) => [
  { header: 'Order', value: (order) => order.order_number },
  { header: 'Quotation', value: (order) => order.quotation_number },
  { header: 'Status', value: (order) => statusText(order.status) },
  { header: 'Placed', value: (order) => dateTime(order.created_at) },
  { header: 'Requested ship date', value: (order) => day(order.requested_ship_date) },
  { header: 'Estimated ship date', value: (order) => (estimates[order.id]?.shipped ? '' : day(estimates[order.id]?.estimatedShipDate)) },
  { header: 'Shipped', value: (order) => day(estimates[order.id]?.shippedOn) },
  { header: 'Container', value: (order) => order.container_size },
  { header: 'Total (PHP)', value: (order) => money(order.total_amount) },
  { header: 'Down payment (PHP)', value: (order) => money(order.down_payment_amount) },
  { header: 'Paid (PHP)', value: (order) => money(order.settled_amount) },
  { header: 'Products', value: (order) => productsText(order.customer_order_items) },
]
