import { supabase } from '../supabase'
import { allRows } from '../utils/estimateLoader'
import { bySize } from '../utils/productGroups'
import { productTransactions } from '../utils/productTransactions'


// =============================================================================
// A product's transactions — loading the data
//
// Every record a product is on: quotation requests, quotations, customer
// orders, and purchase orders with each time their goods were received. The
// shaping is in utils/productTransactions.js. Staff only: customers can't read
// other customers' orders or any purchase order (db/migrations/013).
// =============================================================================

// Who can read quotation requests and quotations (db/migrations/013). The
// other staff can read orders and purchase orders, so they get those.
export const READS_QUOTATIONS = ['admin', 'sales']


// Rows by their ids, a hundred at a time, so a request never gets too long.
async function rowsByIds(table, columns, ids) {
  const rows = []

  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase.from(table).select(columns).in('id', ids.slice(index, index + 100))
    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}


// A product with every size of its family, smallest first (itself alone when
// it has no family). Null when the product isn't there any more.
export async function loadProductSizes(productId) {
  const { data: product, error } = await supabase
    .from('products')
    .select('id, product_name, sku, brand, category, family, pack_size, cbm, gross_weight_kg')
    .eq('id', productId)
    .maybeSingle()

  if (error) throw error
  if (!product) return null
  if (!String(product.family || '').trim()) return { product, sizes: [product] }

  const { data: sizes, error: sizesError } = await supabase
    .from('products')
    .select('id, product_name, sku, brand, category, family, pack_size, cbm, gross_weight_kg')
    .eq('family', product.family)

  if (sizesError) throw sizesError

  return { product, sizes: [...(sizes || [])].sort(bySize) }
}


// Every transaction the products are in (one size, or all the sizes of a
// family). quotations: whether the reader may see quotation requests and
// quotations; without it those lists come back empty.
export async function loadProductTransactions(products, { quotations = false } = {}) {
  const ids = products.map((product) => product.id)
  if (!ids.length) return productTransactions({})

  const [requestItems, quotationItems, orderItems, poLines, receivings, suppliers] = await Promise.all([
    quotations
      ? allRows(() => supabase
        .from('quotation_request_items')
        .select('id, product_id, quantity, quotation_requests ( id, quotation_reference, status, created_at, profiles ( name, company ) )')
        .in('product_id', ids)
        .order('id'))
      : [],
    quotations
      ? allRows(() => supabase
        .from('quotation_items')
        .select('id, product_id, quantity, quotations ( id, quotation_number, status, created_at, expiry_date, quotation_requests ( profiles ( name, company ) ) )')
        .in('product_id', ids)
        .order('id'))
      : [],
    allRows(() => supabase
      .from('customer_order_items')
      .select('id, product_id, quantity, customer_orders ( id, order_number, status, created_at, customer_id )')
      .in('product_id', ids)
      .order('id')),
    allRows(() => supabase
      .from('purchase_order_items')
      .select('id, product_id, supplier_id, ordered_quantity, received_quantity, status, fully_received_at, purchase_orders ( id, po_number, created_at, expected_delivery_date, customer_orders ( order_number ) )')
      .in('product_id', ids)
      .order('id')),
    // Each time goods were received (db/migrations/023). Without it, each
    // line's last receiving is still known from the line itself.
    allRows(() => supabase
      .from('purchase_order_history')
      .select('id, supplier_id, details, happened_at')
      .eq('event', 'goods received')
      .in('details->>product_id', ids)
      .order('id')).catch(() => []),
    supabase.from('suppliers').select('id, supplier_name'),
  ])

  const customerIds = [...new Set(orderItems.map((item) => item.customer_orders?.customer_id).filter(Boolean))]
  const customers = await rowsByIds('profiles', 'id, name, company', customerIds).catch(() => [])

  return productTransactions({
    products,
    requestItems,
    quotationItems,
    orderItems,
    poLines,
    receivings,
    suppliers: Object.fromEntries((suppliers.data || []).map((supplier) => [supplier.id, supplier.supplier_name])),
    customers: Object.fromEntries(customers.map((customer) => [customer.id, customer])),
  })
}
