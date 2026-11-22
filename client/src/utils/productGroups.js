// =============================================================================
// Product families
//
// Each pack size of a product is its own product (its own price, MOQ, weight
// and CBM), but sizes of the same product share a family name, e.g.
// "Argentina Corned Beef" in 150g x 48 and 260g x 48. This only decides how
// sizes are shown together; every order line is still one specific size.
// =============================================================================

// Groups products by family, keeping the order the list arrived in (so a
// search ranking is kept) and each family's sizes in their own order.
export function groupByFamily(products) {
  const groups = []
  const byKey = new Map()

  for (const product of products) {
    const family = (product.family || product.product_name || '').trim()
    const key = family.toLowerCase()
    let group = byKey.get(key)

    if (!group) {
      group = { key, family, brand: product.brand, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }

    group.items.push(product)
  }

  return groups
}


// How one size is labelled under its family, e.g. "150g x 48".
export const sizeLabel = (product) => product.pack_size || 'One size'


// =============================================================================
// Size names
//
// In the catalog, each size of a family with more than one size gets a name
// of its own (Small, Medium, Large), so no size row is left without one. The
// sizes go from smallest to largest by their pack size: the size of one item
// first (25g before 210g), then how many come in a case (25g x 10 x 20 before
// 25g x 10 x 30). Sizes that read the same share a name.
// =============================================================================

const SIZE_NAMES = {
  1: ['Regular'],
  2: ['Small', 'Large'],
  3: ['Small', 'Medium', 'Large'],
  4: ['Small', 'Medium', 'Large', 'Extra Large'],
  5: ['Extra Small', 'Small', 'Medium', 'Large', 'Extra Large'],
}

// Grams or millilitres in one of each measure a pack size can use.
const AMOUNT_IN = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, l: 1000 }

// One item's size and how many come in a case, from a pack size such as
// "25g x 10 x 20" (25 grams, 200 a case) or "1L x 12" (1000 ml, 12 a case).
// The size is null when the pack size has no amount to read.
export function readPackSize(packSize) {
  const text = String(packSize || '').toLowerCase()
  const size = text.match(/(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|cl|l)\b/)
  const rest = size ? text.replace(size[0], ' ') : text
  const count = (rest.match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .reduce((total, number) => total * number, 1)

  return {
    amount: size ? Number(size[1]) * AMOUNT_IN[size[2]] : null,
    count,
  }
}

// What a size is compared by. A pack size with no amount to read goes by
// the case's volume, then its weight, after the ones that can be read.
function sizeOrder(product) {
  const { amount, count } = readPackSize(product.pack_size)

  return amount !== null
    ? [0, amount, count]
    : [1, Number(product.cbm) || 0, Number(product.gross_weight_kg) || 0]
}

function compareOrder(a, b) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }

  return 0
}

// For sorting a family's sizes from smallest to largest.
export function bySize(a, b) {
  return compareOrder(sizeOrder(a), sizeOrder(b))
    || String(a.sku || '').localeCompare(String(b.sku || ''))
}

// The size name of every product in a family of more than one size, by
// product id, e.g. { 'p-1': 'Small', 'p-2': 'Large' }. Give it every size of
// the families shown, so a search that hides one size doesn't change what
// the others are called.
export function sizeNames(products) {
  const names = {}

  for (const group of groupByFamily(products)) {
    if (group.items.length < 2) continue

    // The family's different sizes, smallest first.
    const sizes = []
    for (const order of group.items.map(sizeOrder).sort(compareOrder)) {
      const last = sizes[sizes.length - 1]
      if (!last || compareOrder(last, order) !== 0) sizes.push(order)
    }

    const list = SIZE_NAMES[sizes.length] || sizes.map((_, index) => `Size ${index + 1}`)

    for (const product of group.items) {
      const order = sizeOrder(product)
      names[product.id] = list[sizes.findIndex((size) => compareOrder(size, order) === 0)]
    }
  }

  return names
}
