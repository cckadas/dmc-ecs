// =============================================================================
// An order's payment in one plain sentence
//
// Shared by the data sent to the AI and the rule-based answers, so both say
// the same thing. Matters most for a payment awaiting verification: it has
// been sent, so the customer must not be told to pay it again.
// =============================================================================

export const NOTHING_PAID = 'PHP 0.00'

export function describePayment(payment) {
  const parts = []

  // DMC's rule: not paid within 7 days after the deadline, so it was cancelled.
  if (payment.cancelled) {
    return `this order was cancelled${payment.cancelledOn ? ` on ${payment.cancelledOn}` : ''} because its down payment wasn't received${payment.downPaymentLastDay ? ` by ${payment.downPaymentLastDay}` : ' in time'}; nothing is owed for it and it can no longer be paid. To order these products, send a new quotation request`
  }

  if (payment.fullyPaid) {
    parts.push('fully paid')
  } else if (payment.awaitingVerification) {
    parts.push(`your payment of ${payment.awaitingVerification} was received and is awaiting DMC's verification (nothing more to pay for it now)`)
  } else if (payment.paidAndVerified !== NOTHING_PAID) {
    parts.push(`down payment verified; balance of ${payment.balanceDue} still to pay`)
  } else {
    parts.push(`down payment of ${payment.downPaymentRequired} due${payment.downPaymentDeadline ? ` by ${payment.downPaymentDeadline}` : ''}`)
    if (payment.downPaymentTooLate) {
      parts.push(`the last day to pay was ${payment.downPaymentLastDay}, so it can no longer be paid and the order is being cancelled`)
    } else if (payment.downPaymentOverdue) {
      parts.push(`this is overdue: it can still be paid until ${payment.downPaymentLastDay}; if it isn't, the order will be cancelled on ${payment.cancelledIfUnpaidOn}`)
    }
  }

  if (payment.lastRejectionReason) {
    parts.push(`your last payment was rejected (${payment.lastRejectionReason}), so please pay again with the correct proof`)
  }

  return parts.join('; ')
}
