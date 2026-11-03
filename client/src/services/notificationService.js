import { supabase } from '../supabase'


export async function createNotification({ userId, role, title, message, type = 'info', link = null, relatedCustomerOrderId = null, relatedPurchaseOrderId = null }) {

  if (!userId) {
    throw new Error('Notification requires a user ID.')
  }

  // No reading back: the sender usually can't read a notification addressed to
  // someone else (db/migrations/013).
  const { error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      role,
      title,
      message,
      type,
      link,
      related_customer_order_id: relatedCustomerOrderId,
      related_purchase_order_id: relatedPurchaseOrderId,
    })

  if (error) {
    console.error('Failed to create notification:', error)
    throw error
  }
}