// =============================================================================
// Gemini — the AI behind the DMC Order Assistant
//
// Called over Google's REST API, so the server needs no extra package. The
// key stays on the server (GEMINI_API_KEY in server/.env) and never reaches
// the browser. GEMINI_MODEL is optional: "gemini-flash-lite-latest" always
// points to Google's newest Flash-Lite model, so the assistant keeps working
// when an older model is retired. Flash-Lite answers in about 2 seconds and is
// plenty for answering from the supplied data; the newest full Flash model was
// often overloaded when tested (Oct 2026).
//
// Note: on Google's free tier, what is sent may be used to improve Google's
// products and read by human reviewers. Fine for demo data; real customer
// data needs the paid tier.
// =============================================================================

const DEFAULT_MODEL = 'gemini-flash-lite-latest'
const TIMEOUT_MS = 12_000
const ATTEMPTS = 2

// After this, stop waiting and answer by rule instead.
const TOTAL_WAIT_MS = 20_000
const MIN_RETRY_MS = 3_000

export class AssistantUnavailableError extends Error {
  constructor(code) {
    super(`The AI assistant is unavailable (${code}).`)
    this.name = 'AssistantUnavailableError'
    this.code = code
  }
}

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL


// The model is told to reply in plain text; this tidies up any Markdown it
// adds anyway.
function toPlainText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|\n?```$/g, ''))
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*\*\s+/gm, '- ')
    .trim()
}


export async function askGemini({ systemInstruction, prompt }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) throw new AssistantUnavailableError('no_api_key')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  })

  let lastCode = 'provider_error'
  const giveUpAt = Date.now() + TOTAL_WAIT_MS

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const timeLeft = giveUpAt - Date.now()
    if (attempt > 1 && timeLeft < MIN_RETRY_MS) break

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(TIMEOUT_MS, timeLeft))

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: controller.signal,
      })

      if (!response.ok) {
        // Limits, a bad key or an unknown model won't fix themselves on retry.
        if (response.status === 429) throw new AssistantUnavailableError('rate_limit')
        if ([400, 401, 403, 404].includes(response.status)) {
          throw new AssistantUnavailableError(response.status === 404 ? 'model_not_found' : 'request_rejected')
        }
        lastCode = `http_${response.status}`
        continue
      }

      const data = await response.json()

      if (data.promptFeedback?.blockReason) throw new AssistantUnavailableError('blocked')

      const candidate = data.candidates?.[0]
      const text = (candidate?.content?.parts || [])
        .filter((part) => !part.thought && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')

      const reply = toPlainText(text)
      if (reply) return reply

      if (candidate?.finishReason === 'SAFETY') throw new AssistantUnavailableError('blocked')
      lastCode = 'empty_response'
    } catch (error) {
      if (error instanceof AssistantUnavailableError) throw error
      lastCode = error.name === 'AbortError' ? 'timeout' : 'network'
    } finally {
      clearTimeout(timer)
    }
  }

  throw new AssistantUnavailableError(lastCode)
}
