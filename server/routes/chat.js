import express from 'express'
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
    // The customer comes from their session token (server/auth.js), never from
    // the request body, so no one can ask about another customer's orders.
    const limit = checkRateLimit(req.caller.id)
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds))
      return res.status(429).json({ error: 'You\'ve sent a lot of questions. Please wait a few minutes and try again.' })
    }

    return res.json(await answerCustomerQuestion(req.caller.id, parsed.message, parsed.history))
  } catch (error) {
    // Only what failed, never what the customer asked.
    console.error('Order assistant failed:', error.message, error.cause?.code || '')
    return res.status(500).json({ error: UNAVAILABLE })
  }
})

export default router
