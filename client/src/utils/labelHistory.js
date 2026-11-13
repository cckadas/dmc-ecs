// =============================================================================
// Label history (db/migrations/026)
//
// Every step of a compliance label, with the date and time the database saved
// it and who did it. This turns a saved entry into words; how long the steps
// take is in utils/labelingSteps.js.
// =============================================================================

const normalize = (status) => String(status || '').trim().toLowerCase()

// What each status means, in the order a label goes through them.
const STATUS_TEXT = {
  'original label received': "Original label's photo uploaded by the warehouse",
  'awaiting customer translated design': 'Sent to the customer for its translated design',
  'customer design label received': "Customer's design received",
  'printed & awaiting application': 'Design confirmed and printed',
  'applied to units': 'Labels applied to the units',
}

// What happened, in words.
export function describeLabelStep(entry) {
  const status = normalize(entry.to_status)
  if (STATUS_TEXT[status]) return STATUS_TEXT[status]

  // An older label's start: only its latest step had been kept.
  if (!status) return 'Label started (the step it was in then was not saved)'
  return `Status changed to ${entry.to_status}`
}
