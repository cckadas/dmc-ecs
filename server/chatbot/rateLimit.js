// =============================================================================
// How often one customer can ask the assistant
//
// 30 questions per 10 minutes per customer, so one account can't use up the
// AI provider's free limit for everyone. Kept in memory: it resets when the
// server restarts, which is fine for a single server.
// =============================================================================

const WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS = 30

const requestsByUser = new Map()

export function checkRateLimit(userId, now = Date.now()) {
  const recent = (requestsByUser.get(userId) || []).filter((time) => now - time < WINDOW_MS)

  if (recent.length >= MAX_REQUESTS) {
    requestsByUser.set(userId, recent)
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)) }
  }

  recent.push(now)
  requestsByUser.set(userId, recent)
  return { allowed: true, retryAfterSeconds: 0 }
}
