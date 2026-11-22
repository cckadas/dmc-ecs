import { supabase } from '../supabase'
import { planContainer } from '../utils/containers'
import { withNewColumns } from '../utils/newColumns'
import { countryKey } from '../utils/countryPlaces'
import { rateText } from '../utils/money'


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
// Customers pay in US dollars: each line is the supplier's peso price divided by
// today's exchange rate (the European Central Bank's, fetched by the server),
// plus the markup; containers and shipping are in US dollars (db/migrations/048).
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
  // is_simulated: rates worked out by distance until DMC gives its own
  // (db/migrations/030); asked again without it until that script is run.
  const { data, error } = await withNewColumns((withSimulated) => supabase
    .from('market_markups')
    .select(`country, markup_percent, shipping_cost${withSimulated ? ', is_simulated, shipping_cost_usd' : ''}`)
    .order('country'), ['is_simulated', 'shipping_cost_usd'])

  if (error) throw error

  return data || []
}


// Today's exchange rate, pesos per US dollar: the European Central Bank's,
// fetched by the server by itself (db/migrations/048). Null before 048 is run.
export async function getExchangeRate() {
  const { data, error } = await supabase.rpc('current_exchange_rate')
  if (error) {
    if (/42883|PGRST202|could not find|does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) return null
    throw error
  }
  const row = data?.[0]
  return row ? { rateDate: row.rate_date, phpPerUsd: Number(row.php_per_usd), fetchedAt: row.fetched_at } : null
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


// The country's own rates, matched by its letters as the database does (032),
// or Default's.
function findMarkup(markups, country) {
  return (
    (countryKey(country) && markups.find((markup) => countryKey(markup.country) === countryKey(country))) ||
    markups.find((markup) => countryKey(markup.country) === 'default') ||
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
// carriedLines: goods waiting from a rush shipment (db/migrations/034), already
// paid: not priced, but they go in the container, so they count toward it.
export async function getQuotationPricing({ country, lines, carriedLines = [] }) {
  const productIds = lines.map((line) => line.productId)

  const [supplierPrices, markups, containerSizes, fillPercent, rate] = await Promise.all([
    getCurrentSupplierPrices(productIds),
    getMarkups(),
    getContainerSizes(),
    getContainerFillPercent(),
    getExchangeRate(),
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
    } else if (!rate) {
      source = 'No exchange rate yet — the server fetches it from the European Central Bank'
    } else {
      // The supplier's peso price in US dollars at today's rate, plus the markup (048).
      price = roundMoney((supplierPrice.cost / rate.phpPerUsd) * (1 + Number(markup.markup_percent) / 100))
      source = `${markup.country} markup ${Number(markup.markup_percent)}%, at ${rateText(rate.phpPerUsd)}`
    }

    prices[line.productId] = { price, source, moq }
  }

  const shipping = markup?.shipping_cost_usd == null
    ? {
        cost: null,
        source: `No shipping cost in US dollars for ${country || 'this country'} — admin or management must set one`,
      }
    : {
        cost: roundMoney(Number(markup.shipping_cost_usd)),
        source: markup.country.trim().toLowerCase() === 'default'
          ? `Default shipping cost${country ? ` (none set for ${country})` : ''}`
          : `Fixed shipping cost for ${markup.country}`,
      }

  const containers = planContainer({ lines: [...lines, ...carriedLines], sizes: containerSizes, fillPercent })

  return { prices, shipping, containers, rate }
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
    return 'Prices, shipping or container costs are not fully set up in the database yet — run the scripts in db/migrations (001, 016 and 048) in Supabase.'
  }

  return error?.message || 'Could not load prices.'
}
