import { useEffect, useState } from 'react'
import { supabase } from '../supabase'


// =============================================================================
// EACH PRODUCT'S STAGE (staff only; db/migrations/049)
//
// Each product of an order moves on as its own goods arrive: ordered, paid,
// in the warehouse, then its labels, loaded and shipped. Listed furthest
// behind first, with how long it has been at its stage, so staff see which
// products move fast and which slow. Customers never see this (it would show
// how suppliers perform).
// =============================================================================
const STAGES = [
  'Ordered from supplier',
  'Paid, waiting for delivery',
  'Partly in',
  'In the warehouse',
  'Original label taken',
  'With the customer for their design',
  'Design received',
  'Printed',
  'Labels applied',
  'Loaded',
  'Shipped',
]

const LABEL_STAGE = {
  'original label received': 4,
  'awaiting customer translated design': 5,
  'customer design label received': 6,
  'printed & awaiting application': 7,
  'applied to units': 8,
}

const normalize = (value) => String(value || '').trim().toLowerCase()
const day = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null)
const daysSince = (value) => (value ? Math.max(Math.floor((Date.now() - new Date(value).getTime()) / 86400000), 0) : null)

function stageOf({ item, line, exchange, orderStatus, poCreatedAt }) {
  const status = normalize(orderStatus)
  if (status === 'shipped' || (status === 'partly shipped' && item.loaded_at)) return { index: 10, since: null }
  if (item.loaded_at) return { index: 9, since: item.loaded_at }

  const label = LABEL_STAGE[normalize(exchange?.status)]
  if (label != null) return { index: label, since: exchange.updated_at || exchange.created_at }

  if (!line) return { index: 3, since: null }

  const received = Number(line.received_quantity || 0)
  const complete = ['fully delivered', 'delivered short'].includes(normalize(line.status))
    || received + Number(line.missing_quantity || 0) >= Number(line.ordered_quantity || 0)
  if (complete) return { index: 3, since: line.fully_received_at || line.updated_at }
  if (received > 0) return { index: 2, since: line.updated_at }
  if (line.payment_proof_path) return { index: 1, since: line.updated_at }
  return { index: 0, since: poCreatedAt }
}


export default function ProductStages({ order }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let active = true

    async function load() {
      const [itemsResult, linesResult] = await Promise.all([
        supabase
          .from('customer_order_items')
          .select('id, product_id, quantity, loaded_at, products ( product_name, unit )')
          .eq('customer_order_id', order.id),
        supabase
          .from('purchase_order_items')
          .select('product_id, ordered_quantity, received_quantity, missing_quantity, status, payment_proof_path, fully_received_at, updated_at, suppliers ( supplier_name ), purchase_orders!inner ( customer_order_id, created_at )')
          .eq('purchase_orders.customer_order_id', order.id),
      ])

      const items = itemsResult.data || []
      const { data: exchanges } = items.length
        ? await supabase
          .from('compliance_label_exchanges')
          .select('customer_order_item_id, status, created_at, updated_at')
          .in('customer_order_item_id', items.map((item) => item.id))
        : { data: [] }

      const lineOf = Object.fromEntries((linesResult.data || []).map((line) => [line.product_id, line]))
      const exchangeOf = Object.fromEntries((exchanges || []).map((exchange) => [exchange.customer_order_item_id, exchange]))

      const built = items.map((item) => {
        const line = lineOf[item.product_id]
        const stage = stageOf({
          item,
          line,
          exchange: exchangeOf[item.id],
          orderStatus: order.status,
          poCreatedAt: line?.purchase_orders?.created_at,
        })
        return {
          id: item.id,
          name: item.products?.product_name || 'A product',
          unit: item.products?.unit || 'cases',
          supplier: line?.suppliers?.supplier_name || null,
          ordered: line ? Number(line.ordered_quantity || 0) : null,
          received: line ? Number(line.received_quantity || 0) : null,
          ...stage,
        }
      })

      built.sort((a, b) => a.index - b.index || (daysSince(b.since) ?? 0) - (daysSince(a.since) ?? 0))
      if (active) setRows(built)
    }

    load().catch(() => active && setRows([]))
    return () => { active = false }
  }, [order.id, order.status])

  if (!rows || rows.length === 0) return null

  const behind = rows.length > 1 && rows[0].index < rows[rows.length - 1].index ? rows[0].index : null

  return (
    <div className="mb-6">
      <h3 className="mb-1 text-sm font-semibold text-gray-800">Each product's stage</h3>
      <p className="mb-3 text-xs text-gray-500">
        Each product moves on as its own goods arrive: its labels start as soon as some of its cases are in. Furthest behind first.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">Product</th>
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2">Since</th>
              <th className="px-4 py-2">Cases in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-2">
                  <p className="font-medium text-gray-800">{row.name}</p>
                  {row.supplier && <p className="text-xs text-gray-500">{row.supplier}</p>}
                </td>
                <td className="px-4 py-2">
                  <div className="mb-1 flex gap-0.5" aria-hidden="true">
                    {STAGES.map((stage, index) => (
                      <span key={stage} className={`h-1.5 w-4 rounded-full ${index <= row.index ? 'bg-[#2D5A42]' : 'bg-gray-200'}`} />
                    ))}
                  </div>
                  <p className="text-gray-700">
                    {STAGES[row.index]}
                    {row.index === behind && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Furthest behind</span>}
                  </p>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {row.since ? `${day(row.since)} (${daysSince(row.since)} day${daysSince(row.since) === 1 ? '' : 's'})` : '-'}
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {row.ordered == null ? 'Already in' : `${row.received} of ${row.ordered} ${row.unit}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
