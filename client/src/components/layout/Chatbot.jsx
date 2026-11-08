'use client'

import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faComments, faXmark, faPaperPlane, faHeadset, faUser, faSpinner } from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../../context/AuthContext'
import { askAssistant } from '../../services/chatService'


// ============================================================
// SETTINGS
// ============================================================
// Answers come from the server, which looks up only the signed-in customer's
// own orders and asks Gemini (or answers by rule when Gemini is unavailable).
const MAX_MESSAGE_LENGTH = 1000
const HISTORY_SIZE = 8

const QUICK_QUESTIONS = [
  { label: 'Order status', question: 'Where are my orders now?' },
  { label: 'Ready date', question: 'When will my orders be ready for shipment?' },
  { label: 'Payments', question: 'What do I still owe?' },
  { label: 'Quotations', question: 'Do I have quotations to approve?' },
  { label: 'Help', question: 'What can you help with?' },
]


// ============================================================
// CHATBOT SECTION
// ============================================================
export default function Chatbot() {
  const { profile } = useAuth()

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)


  // ============================================================
  // OPEN CHAT
  // ============================================================
  function openChat() {
    const firstName = profile?.name?.trim().split(' ')[0]

    setMessages((previous) => previous.length ? previous : [
      {
        id: 'intro',
        sender: 'bot',
        text:
          `Hi${firstName ? ` ${firstName}` : ''}! I'm DMC Concierge. Ask me where your orders are, ` +
          'when they should be ready, what you still owe, about your quotations, or how to use the portal. ' +
          'I can look things up for you, but I can\'t change anything.',
      },
    ])

    setOpen(true)
  }


  // ============================================================
  // AUTO SCROLL
  // ============================================================
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages, sending])


  // ============================================================
  // FOCUS INPUT
  // ============================================================
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [open])


  // ============================================================
  // SEND MESSAGE
  // ============================================================
  // Takes the text directly, so Quick Questions send their own question
  // instead of the (still empty) text box.
  async function handleSend(text = message) {
    const trimmedMessage = text.trim()

    if (!trimmedMessage || sending) {
      return
    }

    // The recent conversation, so follow-ups like "and the second one?" make
    // sense. The greeting and error notes are not part of it.
    const history = messages
      .filter((chatMessage) => chatMessage.id !== 'intro' && !chatMessage.isError)
      .slice(-HISTORY_SIZE)
      .map((chatMessage) => ({
        role: chatMessage.sender === 'user' ? 'user' : 'assistant',
        content: chatMessage.text,
      }))

    setSending(true)
    setMessage('')

    setMessages((previous) => [
      ...previous,
      { id: Date.now(), sender: 'user', text: trimmedMessage },
    ])

    try {
      const { reply } = await askAssistant({ message: trimmedMessage, history })

      setMessages((previous) => [
        ...previous,
        { id: Date.now() + 1, sender: 'bot', text: reply },
      ])
    }

    catch (error) {
      setMessages((previous) => [
        ...previous,
        { id: Date.now() + 1, sender: 'bot', text: error.message, isError: true },
      ])
    }

    finally {
      setSending(false)
    }
  }


  // ============================================================
  // ENTER KEY
  // ============================================================
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }


  // ============================================================
  // MAIN CONTENT
  // ============================================================
  return (
    <>
      {/* ========================================================
          CHAT WINDOW
      ======================================================== */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[560px] max-h-[calc(100vh-8rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">

          {/* ====================================================
              HEADER
          ==================================================== */}
          <div className="flex shrink-0 items-center justify-between bg-[#1F3A2C] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
                <FontAwesomeIcon icon={faHeadset} className="text-lg text-white"/>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-white">
                  DMC Concierge
                </h2>

                <p className="mt-0.5 text-xs text-white/60">
                  Your virtual order assistant
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close chatbot"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>


          {/* ====================================================
              MESSAGES
          ==================================================== */}
          <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-4">

            {messages.map((chatMessage) => (
              <div key={chatMessage.id} className={`mb-4 flex items-end gap-2 ${chatMessage.sender === 'user' ? 'justify-end' : 'justify-start'}`}>

                {chatMessage.sender === 'bot' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1F3A2C]">
                    <FontAwesomeIcon icon={faHeadset} className="text-[11px] text-white"/>
                  </div>
                )}

                <div
                  className={`
                    max-w-[78%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${chatMessage.sender === 'user'
                      ? 'rounded-br-md bg-[#2D5A42] text-white'
                      : chatMessage.isError
                        ? 'rounded-bl-md border border-amber-200 bg-amber-50 text-amber-800 shadow-sm'
                        : 'rounded-bl-md border border-gray-200 bg-white text-gray-700 shadow-sm'}
                  `}
                >
                  {chatMessage.text}
                </div>

                {chatMessage.sender === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-200">
                    <FontAwesomeIcon icon={faUser} className="text-[11px] text-gray-500"/>
                  </div>
                )}

              </div>
            ))}


            {/* ==================================================
                TYPING INDICATOR
            ================================================== */}
            {sending && (
              <div className="mb-4 flex items-end gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#1F3A2C]">
                  <FontAwesomeIcon icon={faHeadset} className="text-[11px] text-white"/>
                </div>

                <div className="rounded-2xl rounded-bl-md border border-gray-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '100ms' }}/>
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '200ms' }}/>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>


          {/* ====================================================
              QUICK QUESTIONS
          ==================================================== */}
          {!sending && (
            <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Quick Questions
              </p>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {QUICK_QUESTIONS.map((quick) => (
                  <button
                    key={quick.label}
                    type="button"
                    onClick={() => handleSend(quick.question)}
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-[#2D5A42] hover:bg-[#F4F8F5] hover:text-[#1F3A2C]"
                  >
                    {quick.label}
                  </button>
                ))}
              </div>
            </div>
          )}


          {/* ====================================================
              INPUT
          ==================================================== */}
          <div className="shrink-0 border-t border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1.5 transition focus-within:border-[#2D5A42] focus-within:ring-2 focus-within:ring-[#2D5A42]/10">
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Ask about your orders..."
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400"
              />

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!message.trim() || sending}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1F3A2C] text-white transition hover:bg-[#2D5A42] disabled:cursor-not-allowed disabled:bg-gray-300"
                aria-label="Send message"
              >
                <FontAwesomeIcon icon={ sending ? faSpinner : faPaperPlane} className={sending ? 'animate-spin text-xs' : 'text-xs'}/>
              </button>
            </div>

            <p className="mt-2 text-center text-[10px] text-gray-400">
              AI assistant. Answers are based on your account information.
            </p>
          </div>

        </div>
      )}


      {/* ========================================================
          FLOATING CHAT BUTTON
      ======================================================== */}
      {!open && (
        <button
          type="button"
          onClick={openChat}
          className="
            fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#1F3A2C] text-white
            shadow-lg transition duration-200 hover:scale-105 hover:bg-[#2D5A42] hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-[#2D5A42]/20
          "
          aria-label="Open customer assistant"
        >
          <FontAwesomeIcon icon={faComments} className="text-xl"/>
          <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-green-500" />
        </button>
      )}

    </>
  )
}
