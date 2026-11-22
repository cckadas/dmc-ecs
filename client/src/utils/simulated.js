// =============================================================================
// Simulated records
//
// The made-up history for the demo (db/demo/) marks everything it adds: order
// numbers start SIM-ORD- and PO numbers SIM-PO-. Pages showing figures worked
// out from them say so (components/SimulatedBadge.jsx), so no one takes a
// made-up on-time rate as a fact about a real supplier.
// =============================================================================

export const isSimulated = (number) => typeof number === 'string' && number.startsWith('SIM-')
