// =============================================================================
// Where an order is with its compliance labels, for the label pages' lists
//
// An order is as far along as its least advanced label: it waits on that one.
// A product with no label exchange yet counts as not started. Pure: no imports.
// =============================================================================

export const LABEL_STAGES = [
  'not started',
  'original label received',
  'awaiting customer translated design',
  'customer design label received',
  'printed & awaiting application',
  'applied to units',
]

const normalize = (status) => String(status || '').trim().toLowerCase()

// The least advanced label of an order group's items ({ compliance_label_exchange }).
export function labelStageOf(items) {
  const ranks = (items || []).map((item) => {
    const index = LABEL_STAGES.indexOf(normalize(item?.compliance_label_exchange?.status))
    return index === -1 ? 0 : index
  })
  return LABEL_STAGES[ranks.length ? Math.min(...ranks) : 0]
}

// The words for each stage; the customer is told what's theirs to do.
export function labelStageLabel(stage, { forCustomer = false } = {}) {
  switch (stage) {
    case 'not started': return 'Not started'
    case 'original label received': return 'Original label received'
    case 'awaiting customer translated design': return forCustomer ? 'Waiting for your design' : 'Waiting for the customer\'s design'
    case 'customer design label received': return 'Customer design received'
    case 'printed & awaiting application': return 'Printed, to be applied'
    case 'applied to units': return 'All labels applied'
    default: return stage
  }
}
