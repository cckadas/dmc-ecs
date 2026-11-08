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
