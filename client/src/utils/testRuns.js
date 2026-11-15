// =============================================================================
// Test runs — what the system doesn't learn times from
//
// Trying the system out takes minutes: an order paid, delivered, labeled and
// shipped in one sitting. A real export order takes weeks. So whatever went
// from start to finish in under a day is a test run, and nothing is learned
// from how long it took:
//   an order             from its payment being verified to ready for shipment
//                        (utils/predictions.js)
//   a supplier delivery  from its PO to the last of its goods received
//                        (utils/supplierScores.js)
//   an order's labeling  from reaching the warehouse to ready for shipment
//                        (utils/predictions.js, utils/labelingSteps.js)
//   an arrival           recorded for the day the order shipped, or of an order
//                        that was itself a test run (utils/estimateInputs.js)
//
// A test run still counts as an order: the demand forecast, each product's
// orders and each customer's next order go by what was ordered and when, not
// by how long it took.
//
// No imports, so the estimates, the supplier scores and the server share it.
// =============================================================================

const DAY = 24 * 60 * 60 * 1000

export const TEST_RUN_DAYS = 1

// Whether something that started and finished at these moments was a test run.
export const isTestRun = (startedAt, finishedAt) =>
  (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / DAY < TEST_RUN_DAYS
