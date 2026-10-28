import express from 'express'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { SYSTEM_INSTRUCTIONS, PORTAL_FAQ, getSafetyReply } from '../chatbot/rules.js'
import { buildCustomerContext } from '../chatbot/context.js'
import { askGemini, AssistantUnavailableError } from '../chatbot/gemini.js'
import { getFallbackReply } from '../chatbot/fallback.js'
import { checkRateLimit } from '../chatbot/rateLimit.js'

const router = express.Router()

const MAX_MESSAGE_LENGTH = 1000
const MAX_HISTORY = 8
const MAX_HISTORY_LENGTH = 2000

const UNAVAILABLE = 'The assistant is temporarily unavailable. You can still see your latest order details on My Orders.'


// =============================================
// VALIDATION
// =============================================
function parseBody(body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message || message.length > MAX_MESSAGE_LENGTH) return null

  const rawHistory = body.history ?? []
  if (!Array.isArray(rawHistory)) return null

  const history = rawHistory
    .slice(-MAX_HISTORY)
    .filter((entry) => ['user', 'assistant'].includes(entry?.role) && typeof entry?.content === 'string')
    .map((entry) => ({ role: entry.role, content: entry.content.trim().slice(0, MAX_HISTORY_LENGTH) }))
    .filter((entry) => entry.content)

  return { message, history }
}


// =============================================
// SIGNED-IN CUSTOMER ONLY
// =============================================
// The browser sends the customer's Supabase session token. The customer id
// comes from that token, never from the request body, so no one can ask about
// another customer's orders.
async function getCustomer(req) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return { status: 401 }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return { status: 401 }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  if (profileError || profile?.role?.trim().toLowerCase() !== 'customer') return { status: 403 }

  return { id: data.user.id }
}


// =============================================
// THE ANSWER
// =============================================
// Rules first, then Gemini, then the rule-based backup. Kept apart from the
// web request so it can be tested on its own.
export async function answerCustomerQuestion(customerId, message, history = []) {
  // Answered by rule, so they can never be talked around.
  const safetyReply = getSafetyReply(message)
  if (safetyReply) return { reply: safetyReply, source: 'safety' }

  const context = await buildCustomerContext(customerId, message)

  try {
    const reply = await askGemini({
      systemInstruction: SYSTEM_INSTRUCTIONS,
      prompt: JSON.stringify({
        task: 'Answer only the current question, using only customerData and approvedFaq. Follow the rules in your instructions.',
        customerData: context,
        approvedFaq: PORTAL_FAQ,
        recentConversation: history,
        currentQuestion: message,
      }),
    })

    return { reply, source: 'gemini' }
  } catch (error) {
    // Without the AI the assistant still answers, from the same data.
    const code = error instanceof AssistantUnavailableError ? error.code : 'unexpected'
    if (code !== 'no_api_key') console.warn(`Order assistant: AI unavailable (${code}), answered by rule.`)

    return { reply: getFallbackReply(message, context), source: 'fallback' }
  }
}


// =============================================
// ASK THE ORDER ASSISTANT
// =============================================
router.post('/', async (req, res) => {
  const parsed = parseBody(req.body)
  if (!parsed) {
    return res.status(400).json({ error: `Please type a question of up to ${MAX_MESSAGE_LENGTH} characters.` })
  }

  try {
    const customer = await getCustomer(req)
    if (customer.status === 401) return res.status(401).json({ error: 'Please sign in again.' })
    if (customer.status === 403) return res.status(403).json({ error: 'The assistant is for customer accounts.' })

    const limit = checkRateLimit(customer.id)
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds))
      return res.status(429).json({ error: 'You\'ve sent a lot of questions. Please wait a few minutes and try again.' })
    }

    return res.json(await answerCustomerQuestion(customer.id, parsed.message, parsed.history))
  } catch (error) {
    // Only what failed, never what the customer asked.
    console.error('Order assistant failed:', error.message, error.cause?.code || '')
    return res.status(500).json({ error: UNAVAILABLE })
  }
})

export default router
