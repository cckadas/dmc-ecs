import { supabase } from '../supabase'
import { planContainer } from '../utils/containers'


// =============================================================================
// Pricing
//
// Buying prices come from each supplier's current price list
// (supplier_price_list). A quotation's prices are fixed, never typed:
//   each line = supplier price + the destination country's markup
//   container = the fixed cost of the container size the order needs
//   shipping  = the destination country's fixed shipping cost
// using the country's own rates, or the Default row's for a country without
// its own. Sales cannot change them, so a wrong price can't be entered by
// accident or on purpose. Rates are set by admin and management only, and the
// database sets the container and shipping costs itself (db/migrations/016).
// =============================================================================

const priceKey = (supplierId, productId) => `${supplierId}:${productId}`

const roundMoney = (value) => Math.round(value * 100) / 100


// Current price-list rows for the given products, keyed by supplier+product
// so a product whose supplier changed never picks up the old supplier's price.
export async function getCurrentSupplierPrices(productIds) {
  if (productIds.length === 0) return {}

  const { data, error } = await supabase
    .from('supplier_price_list')
    .select('supplier_id, product_id, unit_price, min_order_qty')
    .in('product_id', productIds)
    .is('effective_to', null)

  if (error) throw error

  const prices = {}

  for (const row of data || []) {
    prices[priceKey(row.supplier_id, row.product_id)] = {
      cost: Number(row.unit_price),
      moq: row.min_order_qty,
    }
  }

  return prices
}


export function lookupSupplierPrice(prices, supplierId, productId) {
  return prices[priceKey(supplierId, productId)] || null
}


// Each product's minimum order quantity: the one its supplier's current price
// list gives. Readable by customers too — the database returns the MOQ only,
// never the prices (db/migrations/005). Returns { [productId]: moq }.
export async function getMinimumOrderQuantities() {
  const { data, error } = await supabase.rpc('product_minimum_order_quantities')

  if (error) throw error

  return Object.fromEntries(
    (data || []).map((row) => [row.product_id, row.min_order_qty])
  )
}


// Each product's manufacturer name, for the customer catalog. Customers can't read
// the suppliers table; the database returns manufacturers' names only, never a
// distributor or any contact details (db/migrations/013). Returns { [productId]: name }.
export async function getProductManufacturers() {
  const { data, error } = await supabase.rpc('product_manufacturers')

  if (error) throw error

  return Object.fromEntries(
    (data || []).map((row) => [row.product_id, row.manufacturer_name])
  )
}


export async function getMarkups() {
  const { data, error } = await supabase
    .from('market_markups')
    .select('country, markup_percent, shipping_cost')
    .order('country')

  if (error) throw error

  return data || []
}


export async function getContainerSizes() {
  const { data, error } = await supabase
    .from('container_sizes')
    .select('code, name, inside_cbm, max_weight_kg, cost, sort_order')
    .order('sort_order')

  if (error) throw error

  return data || []
}


// How full a container's volume may be packed, in percent (100 if not set).
export async function getContainerFillPercent() {
  const { data, error } = await supabase
    .from('business_settings')
    .select('value')
    .eq('key', 'container_fill_percent')
    .maybeSingle()

  if (error) throw error

  return data?.value == null ? 100 : Number(data.value)
}


function findMarkup(markups, country) {
  const normalise = (value) => (value || '').trim().toLowerCase()

  return (
    markups.find((markup) => normalise(markup.country) === normalise(country)) ||
    markups.find((markup) => normalise(markup.country) === 'default') ||
    null
  )
}


// The fixed prices for a quotation.
// lines: [{ productId, supplierId, quantity, name, cbm, grossWeightKg }]
// Returns {
//   prices:     { [productId]: { price, source, moq } },
//   shipping:   { cost, source },
//   containers: which container the order needs (see planContainer); each
//               option carries its fixed cost
// } — a price or cost is null when it can't be worked out yet, and its source
// then says who has to fix it.
export async function getQuotationPricing({ country, lines }) {
  const productIds = lines.map((line) => line.productId)

  const [supplierPrices, markups, containerSizes, fillPercent] = await Promise.all([
    getCurrentSupplierPrices(productIds),
    getMarkups(),
    getContainerSizes(),
    getContainerFillPercent(),
  ])

  const markup = findMarkup(markups, country)
  const prices = {}

  for (const line of lines) {
    const supplierPrice = lookupSupplierPrice(supplierPrices, line.supplierId, line.productId)
    const moq = supplierPrice?.moq ?? null

    let price = null
    let source

    if (!supplierPrice) {
      source = 'No supplier price yet — procurement must add it in Price Lists'
    } else if (!markup) {
      source = `No markup for ${country || 'this country'} — admin or management must set one`
    } else {
      price = roundMoney(supplierPrice.cost * (1 + Number(markup.markup_percent) / 100))
      source = `${markup.country} markup ${Number(markup.markup_percent)}%`
    }

    prices[line.productId] = { price, source, moq }
  }

  const shipping = markup?.shipping_cost == null
    ? {
        cost: null,
        source: `No shipping cost for ${country || 'this country'} — admin or management must set one`,
      }
    : {
        cost: roundMoney(Number(markup.shipping_cost)),
        source: markup.country.trim().toLowerCase() === 'default'
          ? `Default shipping cost${country ? ` (none set for ${country})` : ''}`
          : `Fixed shipping cost for ${markup.country}`,
      }

  const containers = planContainer({ lines, sizes: containerSizes, fillPercent })

  return { prices, shipping, containers }
}


// Saves one or more of a supplier's prices in a single transaction — used for
// a single edited price as well as a whole imported file. The database
// function keeps each old price as history, skips rows that didn't change,
// and corrects a same-day price in place (see import_supplier_price_list in
// db/migrations).
export async function saveSupplierPrices({ supplierId, effectiveFrom, rows }) {
  const { data, error } = await supabase.rpc('import_supplier_price_list', {
    p_supplier_id: supplierId,
    p_effective_from: effectiveFrom,
    p_rows: rows,
  })

  if (error) throw error

  return data
}


// Explains the most likely failure: the database script hasn't been run yet.
export function pricingErrorMessage(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`

  if (/PGRST20[25]|42P01|42883|does not exist|could not find/i.test(text)) {
    return 'Prices, shipping or container costs are not fully set up in the database yet — run the scripts in db/migrations (001 and 016) in Supabase.'
  }

  return error?.message || 'Could not load prices.'
}
