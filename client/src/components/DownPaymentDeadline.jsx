import { deadlineNote } from '../utils/deadlineNote'


// =============================================
// DOWN PAYMENT DEADLINE
//
// One short line under an order: its down payment deadline, or when and why
// it was cancelled (the words: utils/deadlineNote.js).
// =============================================
export default function DownPaymentDeadline({ order, forStaff = false, short = true, className = '' }) {
  const note = deadlineNote(order, { forStaff, short })
  if (!note) return null

  return (
    <p className={`text-xs font-medium ${note.tone === 'red' ? 'text-red-700' : 'text-amber-700'} ${className}`}>
      {note.text}
    </p>
  )
}
