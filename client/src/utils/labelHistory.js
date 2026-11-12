// =============================================================================
// Label history (db/migrations/026)
//
// Every step of a compliance label, with the date and time the database saved
// it and who did it. These turn the saved entries into words, and into how
// long each step usually takes.
//
// Imports carry their .js extension so the maths can be tested in Node.
// =============================================================================

import { MIN_RECORDS, blendStep } from './predictions.js'

const DAY = 24 * 60 * 60 * 1000
const normalize = (status) => String(status || '').trim().toLowerCase()

// What each status means, in the order a label goes through them.
const STATUS_TEXT = {
  'original label received': "Original label's photo uploaded by the warehouse",
  'awaiting customer translated design': 'Sent to the customer for its translated design',
  'customer design label received': "Customer's design received",
  'printed & awaiting application': 'Design confirmed and printed',
  'applied to units': 'Labels applied to the units',
}

// The time from one status to the next, and who it waits on.
export const LABEL_STEPS = [
  { key: 'forward', from: 'original label received', to: 'awaiting customer translated design', label: 'Sales sends it to the customer' },
  { key: 'design', from: 'awaiting customer translated design', to: 'customer design label received', label: 'Customer sends its design' },
  { key: 'print', from: 'customer design label received', to: 'printed & awaiting application', label: 'Sales confirms and prints it' },
  { key: 'apply', from: 'printed & awaiting application', to: 'applied to units', label: 'Warehouse applies it' },
]


// What happened, in words.
export function describeLabelStep(entry) {
  const status = normalize(entry.to_status)
  if (STATUS_TEXT[status]) return STATUS_TEXT[status]

  // An older label's start: only its latest step had been kept.
  if (!status) return 'Label started (the step it was in then was not saved)'
  return `Status changed to ${entry.to_status}`
}


// How long each label step usually takes, from every label's saved steps: the
// days from one status to the next. A step with fewer than MIN_RECORDS labels
// has no numbers yet. The same shape as utils/analytics.js stepTimes.
//   history: [{ exchange_id, to_status, happened_at }]
export function labelStepTimes(history = []) {
  const byLabel = new Map()
  for (const entry of history) {
    if (!byLabel.has(entry.exchange_id)) byLabel.set(entry.exchange_id, [])
    byLabel.get(entry.exchange_id).push(entry)
  }

  const durations = Object.fromEntries(LABEL_STEPS.map((step) => [step.key, []]))
  for (const entries of byLabel.values()) {
    entries.sort((a, b) => Date.parse(a.happened_at) - Date.parse(b.happened_at))

    for (let index = 1; index < entries.length; index++) {
      const from = normalize(entries[index - 1].to_status)
      const to = normalize(entries[index].to_status)
      const step = LABEL_STEPS.find((candidate) => candidate.from === from && candidate.to === to)
      if (step) durations[step.key].push((Date.parse(entries[index].happened_at) - Date.parse(entries[index - 1].happened_at)) / DAY)
    }
  }

  return LABEL_STEPS.map((step) => {
    const span = blendStep(durations[step.key])
    return {
      key: step.key,
      label: step.label,
      typical: span?.typical ?? null,
      quick: span?.quick ?? null,
      slow: span?.slow ?? null,
      records: durations[step.key].length,
      needed: MIN_RECORDS,
    }
  })
}
