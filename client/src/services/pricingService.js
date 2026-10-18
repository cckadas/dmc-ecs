import { supabase } from '../supabase'


// =============================================================================
// Pricing
//
// Buying prices come from each supplier's current price list
// (supplier_price_list). A quotation's prices are fixed, never typed:
//   each line = supplier price + the destination country's markup
//   shipping  = the country's shipping rate per unit x total units ordered
// using the country's own rates, or the Default row's for a country without
// its own. Sales cannot change them, so a wrong price can't be entered by
// accident or on purpose. Rates are set by admin and management only.
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


export async function getMarkups() {
  const { data, error } = await supabase
    .from('market_markups')
    .select('country, markup_percent, shipping_per_unit')
    .order('country')

  if (error) throw error

  return data || []
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
// lines: [{ productId, supplierId, quantity }]
// Returns {
//   prices:   { [productId]: { price, source, moq } },
//   shipping: { cost, source },
// } — a price or cost is null when it can't be worked out yet, and its source
// then says who has to fix it.
export async function getQuotationPricing({ country, lines }) {
  const productIds = lines.map((line) => line.productId)

  const [supplierPrices, markups] = await Promise.all([
    getCurrentSupplierPrices(productIds),
    getMarkups(),
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

  const totalUnits = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
  const rate = markup?.shipping_per_unit == null ? null : Number(markup.shipping_per_unit)

  const shipping = rate == null
    ? {
        cost: null,
        source: `No shipping rate for ${country || 'this country'} — admin or management must set one`,
      }
    : {
        cost: roundMoney(rate * totalUnits),
        source: `${markup.country} rate ₱${rate.toLocaleString(undefined, { minimumFractionDigits: 2 })} × ${totalUnits.toLocaleString()} units`,
      }

  return { prices, shipping }
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
    return 'Prices or shipping rates are not fully set up in the database yet — run the scripts in db/migrations (001 and 003) in Supabase.'
  }

  return error?.message || 'Could not load prices.'
}
