import { downPaymentStatus, formatDay } from './paymentDeadline.js'
import { formatDateTime } from './dates.js'


// =============================================
// DOWN PAYMENT DEADLINE: THE WORDS
//
// What an order's down payment deadline means today (DMC's rule,
// db/migrations/028): pay by the deadline; after it, the last day it can
// still be paid and the day the order is cancelled; or that it was
// cancelled, when and why. Nothing once a payment was sent or the down
// payment was paid: the balance has no deadline. short = for a list.
// =============================================

// The words and how urgent they are ('amber' or 'red'), or null.
export function deadlineNote(order, { forStaff = false, short = false, today } = {}) {
  const deadline = downPaymentStatus(order, today)
  const { deadline: due, lastDay, cancelOn } = deadline
  const day = formatDay

  switch (deadline.state) {
    case 'due':
      return due ? { tone: 'amber', text: `Down payment due by ${day(due)}.` } : null
    case 'due soon':
      return { tone: 'red', text: `Down payment due by ${day(due)}.` }
    case 'due today':
      return {
        tone: 'red',
        text: short
          ? `Down payment due today. If not paid by ${day(lastDay)}, it's cancelled on ${day(cancelOn)}.`
          : `Down payment due today. If it isn't received by ${day(lastDay)}, the order will be cancelled on ${day(cancelOn)}.`,
      }
    case 'overdue':
      if (forStaff) {
        return { tone: 'red', text: `Down payment overdue since ${day(due)}. Cancelled automatically on ${day(cancelOn)} if not received by ${day(lastDay)}.` }
      }
      return {
        tone: 'red',
        text: short
          ? `Overdue. If not paid by ${day(lastDay)}, it's cancelled on ${day(cancelOn)}.`
          : `Overdue since ${day(due)}. If it isn't received by ${day(lastDay)}, the order will be cancelled on ${day(cancelOn)}.`,
      }
    case 'closed':
      return {
        tone: 'red',
        text: forStaff || short
          ? `Not paid by ${day(lastDay)}: being cancelled.`
          : `The last day to pay was ${day(lastDay)}, so this order is being cancelled.`,
      }
    case 'cancelled':
      if (short) return { tone: 'red', text: lastDay ? `Down payment not received by ${day(lastDay)}.` : 'Cancelled.' }
      return {
        tone: 'red',
        text: `Cancelled${order.cancelled_at ? ` on ${formatDateTime(order.cancelled_at)}` : ''}. ${order.cancellation_reason || ''}`.trim(),
      }
    default:
      return null
  }
}
