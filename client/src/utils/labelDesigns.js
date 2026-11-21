// =============================================================================
// Label designs the customer still owes
//
// After the down payment, the one step that waits on the customer is handing in
// their translated label design: sales marks a product "awaiting customer
// translated design" once DMC has the original label. Until the customer
// uploads it (Compliance Labels), labeling can't finish.
// =============================================================================

export const AWAITING_CUSTOMER_DESIGN = 'awaiting customer translated design'

// The order's products waiting on the customer's design. The order's items
// need compliance_label_exchanges ( status ) nested.
export function labelDesignsNeeded(order) {
  return (order?.customer_order_items || []).filter((item) =>
    (item.compliance_label_exchanges || []).some((exchange) => exchange.status?.trim().toLowerCase() === AWAITING_CUSTOMER_DESIGN))
}
