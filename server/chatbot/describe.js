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

  if (payment.fullyPaid) {
    parts.push('fully paid')
  } else if (payment.awaitingVerification) {
    parts.push(`your payment of ${payment.awaitingVerification} was received and is awaiting DMC's verification (nothing more to pay for it now)`)
  } else if (payment.paidAndVerified !== NOTHING_PAID) {
    parts.push(`down payment verified; balance of ${payment.balanceDue} still to pay`)
  } else {
    parts.push(`down payment of ${payment.downPaymentRequired} due${payment.downPaymentDeadline ? ` by ${payment.downPaymentDeadline}` : ''}`)
    if (payment.downPaymentOverdue) parts.push('this is overdue, but it can still be paid')
  }

  if (payment.lastRejectionReason) {
    parts.push(`your last payment was rejected (${payment.lastRejectionReason}), so please pay again with the correct proof`)
  }

  return parts.join('; ')
}
