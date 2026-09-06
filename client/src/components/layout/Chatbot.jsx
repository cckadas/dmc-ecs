'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faComments, faXmark, faPaperPlane, faHeadset, faUser, faSpinner } from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../supabase'


// ============================================================
// STATUS HELPERS
// ============================================================
function formatStatus(status) {
  if (!status) return 'Unknown'

  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}


function getStatusDescription(status) {
  switch (status?.toLowerCase()) {
    case 'pending payment':
      return 'Your order is currently waiting for payment.'

    case 'submitted':
      return 'Your order has been submitted and is being reviewed.'

    case 'payment verified':
      return 'Your payment has been verified and your order can proceed.'

    case 'procurement':
      return 'Your order is currently being processed for procurement.'

    case 'warehouse preparation':
      return 'Your order is being prepared in the warehouse.'

    case 'ready for shipment':
      return 'Your order is ready to be shipped.'

    case 'shipped':
      return 'Your order has been completed.'

    case 'cancelled':
      return 'Your order has been cancelled.'

    default:
      return `Your order is currently marked as ${formatStatus(status)}.`
  }
}


// ============================================================
// DATE HELPERS
// ============================================================
function formatDate(date) {
  if (!date) return 'Not available'

  const parsedDate = new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Not available'
  }

  return parsedDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}


function getDaysUntil(date) {
  if (!date) return null

  const target = new Date(`${date}T00:00:00`)
  const today = new Date()

  today.setHours(0, 0, 0, 0)

  const difference = target.getTime() - today.getTime()

  return Math.ceil(difference / (1000 * 60 * 60 * 24))
}


// ============================================================
// INTENT DETECTION
// ============================================================
function detectIntent(message) {
  const text = message.toLowerCase().trim()

  // -----------------------------------
  // STATUS INTENT
  // -----------------------------------
  if (
    text.includes('status') ||
    text.includes('where') ||
    text.includes('progress') ||
    text.includes('stage')
  ) {
    return 'status'
  }


  // -----------------------------------
  // DELIVERY INTENT
  // -----------------------------------
  if (
    text.includes('when') ||
    text.includes('arrive') ||
    text.includes('delivery') ||
    text.includes('deliver') ||
    text.includes('timeline') ||
    text.includes('how long')
  ) {
    return 'delivery'
  }


  // -----------------------------------
  // PAYMENT INTENT
  // -----------------------------------
  if (
    text.includes('payment') ||
    text.includes('paid') ||
    text.includes('pay')
  ) {
    return 'payment'
  }


  // -----------------------------------
  // ORDER COUNT INTENT
  // -----------------------------------
  if (
    text.includes('how many') ||
    text.includes('count') ||
    text.includes('orders') ||
    text.includes('order do i have')
  ) {
    return 'order_count'
  }


  // -----------------------------------
  // COMPLETED INTENT
  // -----------------------------------
  if (
    text.includes('shipped') ||
    text.includes('finished')
  ) {
    return 'shipped'
  }


  // -----------------------------------
  // PENDING INTENT
  // -----------------------------------
  if (
    text.includes('pending') ||
    text.includes('waiting')
  ) {
    return 'pending'
  }


  // -----------------------------------
  // GREETING INTENT
  // -----------------------------------
  if (
    text.includes('hello') ||
    text.includes('hi') ||
    text.includes('hey')
  ) {
    return 'greeting'
  }


  // -----------------------------------
  // HELP INTENT
  // -----------------------------------
  if (
    text.includes('what can you') ||
    text.includes('what can i ask') ||
    text.includes('help') ||
    text === '?'
  ) {
    return 'help'
  }


  // -----------------------------------
  // GENERAL INTENT
  // -----------------------------------
  return 'general'
}


// ============================================================
// ORDER IDENTIFICATION
// ============================================================
function findOrderFromMessage(message, orders) {
  const text = message.toLowerCase()

  if (!orders?.length) {
    return null
  }

  /* Try to find an exact order number mentioned in the message */
  const exactMatch = orders.find((order) => {
    const orderNumber = String(
      order.order_number ||
      order.po_number ||
      order.id ||
      ''
    ).toLowerCase()

    return orderNumber && text.includes(orderNumber)
  })

  if (exactMatch) {
    return exactMatch
  }

  /* Also allow the user to mention the UUID */
  const uuidMatch = orders.find((order) => {
    return text.includes(String(order.id).toLowerCase())
  })

  if (uuidMatch) {
    return uuidMatch
  }

  return null
}


// ============================================================
// CHATBOT SECTION
// ============================================================
export default function Chatbot() {
  const { profile } = useAuth()

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)


  // ============================================================
  // LOAD CUSTOMER ORDERS
  // ============================================================
  async function loadCustomerOrders() {
    if (!profile?.id) {
      return
    }

    setLoadingOrders(true)

    try {
      const { data, error } = await supabase
        .from('customer_orders')
        .select(`
          id,
          order_number,
          status,
          created_at,
          estimated_ship_date
        `)
        .eq('customer_id', profile.id)
        .order('created_at', { ascending: false })

      if (error) {
        throw error
      }

      setOrders(data || [])
    }
    
    catch (error) {
      console.error('Failed to load customer orders:', error)
      setOrders([])
    }
    
    finally {
      setLoadingOrders(false)
    }
  }


  // ============================================================
  // INITIAL LOAD
  // ============================================================
  useEffect(() => {
    if (open && profile?.id) {
      loadCustomerOrders()
    }
  }, [open, profile?.id])


  // ============================================================
  // INITIAL MESSAGE
  // ============================================================
  useEffect(() => {
    if (!open) {
      return
    }

    if (messages.length === 0) {
      setMessages([
        {
          id: Date.now(),
          sender: 'bot',
          text: "Hi! I'm your virtual assistant. I can help you check your order status, delivery timelines, payment status, and other information about your orders.",
        },
      ])
    }
  }, [open])


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
  // ORDER SUMMARY
  // ============================================================
  const orderSummary = useMemo(() => {
    const total = orders.length

    const active = orders.filter((order) => order.status !== 'shipped' && order.status !== 'cancelled').length
    const shipped = orders.filter((order) => order.status === 'shipped').length
    const pendingPayment = orders.filter((order) => order.status === 'pending payment').length
    const readyForShipment = orders.filter((order) => order.status === 'ready for shipment').length

    return { total, active, shipped, pendingPayment, readyForShipment }
  }, [orders])


  // ============================================================
  // GENERATE RESPONSE
  // ============================================================
  function generateResponse(userMessage) {

    const intent = detectIntent(userMessage)
    const mentionedOrder = findOrderFromMessage( userMessage, orders )

    // ----------------------------------------------------------
    // NO ORDERS
    // ----------------------------------------------------------
    if (!orders.length) {
      return (
        "I couldn't find any orders associated with your account. " +
        "If you believe this is incorrect, please contact the appropriate support team."
      )
    }


    // ----------------------------------------------------------
    // GREETING
    // ----------------------------------------------------------
    if (intent === 'greeting') {
      return (
        `Hello! You currently have ${orderSummary.total} ` +
        `${orderSummary.total === 1 ? 'order' : 'orders'} on your account. ` +
        `I can help you check their status, delivery timeline, payment status, or other order information.`
      )
    }


    // ----------------------------------------------------------
    // HELP
    // ----------------------------------------------------------
    if (intent === 'help') {
      return (
        "You can ask me things like:\n\n" +
        "• What is the status of my order?\n" +
        "• When will my order arrive?\n" +
        "• Do I have any pending payments?\n" +
        "• How many orders do I have?\n" +
        "• Which orders are shipped?\n" +
        "• What is the status of order [order number]?\n\n" +
        "I can provide information about your orders, but I cannot make changes or perform actions."
      )
    }


    // ----------------------------------------------------------
    // SPECIFIC ORDER STATUS
    // ----------------------------------------------------------
    if (intent === 'status' && mentionedOrder) {
      const status = formatStatus(mentionedOrder.status)

      return (
        `Order ${mentionedOrder.order_number || mentionedOrder.id} ` +
        `is currently **${status}**.\n\n` +
        `${getStatusDescription(mentionedOrder.status)}`
      )
    }


    // ----------------------------------------------------------
    // GENERAL STATUS
    // ----------------------------------------------------------
    if (intent === 'status') {
      const activeOrders = orders.filter(
        (order) =>
          order.status !== 'shipped' &&
          order.status !== 'cancelled'
      )

      if (!activeOrders.length) {
        return (
          "You don't currently have any active orders. " +
          `You have ${orderSummary.shipped} shipped ` +
          `${orderSummary.shipped === 1 ? 'order' : 'orders'}.`
        )
      }

      const orderLines = activeOrders
        .slice(0, 5)
        .map((order) => {
          return (
            `• ${order.order_number || order.id}: ` +
            `${formatStatus(order.status)}`
          )
        })
        .join('\n')

      return (
        `You currently have ${activeOrders.length} active ` +
        `${activeOrders.length === 1 ? 'order' : 'orders'}:\n\n` +
        `${orderLines}\n\n` +
        `Ask me about a specific order if you'd like more details.`
      )
    }


    // ----------------------------------------------------------
    // SPECIFIC ORDER DELIVERY
    // ----------------------------------------------------------
    if (intent === 'delivery' && mentionedOrder) {
      if (!mentionedOrder.estimated_ship_date) {
        return (
          `I found order ${mentionedOrder.order_number || mentionedOrder.id}, ` +
          `but there is currently no expected delivery date recorded for it.`
        )
      }

      const deliveryDate = formatDate(
        mentionedOrder.estimated_ship_date
      )

      const days = getDaysUntil(
        mentionedOrder.estimated_ship_date
      )

      // eslint-disable-next-line no-useless-assignment
      let timing = ''

      if (days > 0) {
        timing = `That's approximately ${days} day${days === 1 ? '' : 's'} from today.`
      }
      
      else if (days === 0) {
        timing = 'The expected delivery date is today.'
      }
      
      else {
        timing = 'The expected delivery date has already passed. ' + 'The order status may provide more information about its progress.'
      }

      return (
        `Order ${mentionedOrder.order_number || mentionedOrder.id} ` +
        `has an expected delivery date of **${deliveryDate}**.\n\n` +
        `${timing}`
      )
    }


    // ----------------------------------------------------------
    // GENERAL DELIVERY
    // ----------------------------------------------------------
    if (intent === 'delivery') {
      const ordersWithDates = orders.filter(
        (order) => order.estimated_ship_date
      )

      if (!ordersWithDates.length) {
        return (
          "I don't currently have an expected delivery date recorded " +
          "for any of your orders."
        )
      }

      const orderLines = ordersWithDates
        .slice(0, 5)
        .map((order) => {
          return (
            `• ${order.order_number || order.id}: ` +
            `${formatDate(order.estimated_ship_date)}`
          )
        })
        .join('\n')

      return (
        "Here are the expected delivery dates currently recorded for your orders:\n\n" +
        `${orderLines}\n\n` +
        "These dates are based on the information currently recorded in the system."
      )
    }


    // ----------------------------------------------------------
    // PAYMENT
    // ----------------------------------------------------------
    if (intent === 'payment') {
      if (orderSummary.pendingPayment === 0) {
        return (
          "I don't see any orders currently marked as pending payment."
        )
      }

      const pendingOrders = orders.filter(
        (order) => order.status === 'pending payment'
      )

      const orderLines = pendingOrders
        .slice(0, 5)
        .map((order) => {
          return (
            `• ${order.order_number || order.id}: Pending payment`
          )
        })
        .join('\n')

      return (
        `You currently have ${orderSummary.pendingPayment} ` +
        `${orderSummary.pendingPayment === 1 ? 'order' : 'orders'} ` +
        `marked as pending payment:\n\n` +
        `${orderLines}\n\n` +
        "I can provide the payment status, but I cannot process or make payments."
      )
    }


    // ----------------------------------------------------------
    // ORDER COUNT
    // ----------------------------------------------------------
    if (intent === 'order_count') {
      return (
        `You currently have ${orderSummary.total} ` +
        `${orderSummary.total === 1 ? 'order' : 'orders'} in total.\n\n` +
        `• Active: ${orderSummary.active}\n` +
        `• Completed: ${orderSummary.shipped}\n` +
        `• Pending payment: ${orderSummary.pendingPayment}\n` +
        `• Ready for shipment: ${orderSummary.readyForShipment}`
      )
    }


    // ----------------------------------------------------------
    // COMPLETED ORDERS
    // ----------------------------------------------------------
    if (intent === 'shipped') {
      const completedOrders = orders.filter(
        (order) => order.status === 'shipped'
      )

      if (!completedOrders.length) {
        return "You don't currently have any shipped orders."
      }

      const orderLines = completedOrders
        .slice(0, 5)
        .map((order) => {
          return `• ${order.order_number || order.id}`
        })
        .join('\n')

      return (
        `You have ${completedOrders.length} shipped ` +
        `${completedOrders.length === 1 ? 'order' : 'orders'}:\n\n` +
        `${orderLines}`
      )
    }


    // ----------------------------------------------------------
    // PENDING ORDERS
    // ----------------------------------------------------------
    if (intent === 'pending') {
      const pendingOrders = orders.filter((order) => order.status !== 'shipped' && order.status !== 'cancelled')

      if (!pendingOrders.length) {
        return "You don't currently have any active or pending orders."
      }

      const orderLines = pendingOrders
        .slice(0, 5)
        .map((order) => {
          return (
            `• ${order.order_number || order.id}: ` +
            `${formatStatus(order.status)}`
          )
        })
        .join('\n')

      return (
        `You have ${pendingOrders.length} active ` +
        `${pendingOrders.length === 1 ? 'order' : 'orders'}:\n\n` +
        `${orderLines}`
      )
    }


    // ----------------------------------------------------------
    // SPECIFIC ORDER WITHOUT DETECTED INTENT
    // ----------------------------------------------------------
    if (mentionedOrder) {
      return (
        `I found order ${mentionedOrder.order_number || mentionedOrder.id}.\n\n` +
        `Status: ${formatStatus(mentionedOrder.status)}\n` +
        `Created: ${formatDate(mentionedOrder.created_at)}\n` +
        `Expected delivery: ${formatDate(mentionedOrder.estimated_ship_date)}\n\n` +
        `${getStatusDescription(mentionedOrder.status)}`
      )
    }


    // ----------------------------------------------------------
    // GENERAL FALLBACK
    // ----------------------------------------------------------
    return (
      "I can help you with information about your orders, including:\n\n" +
      "• Order status\n" +
      "• Expected delivery dates\n" +
      "• Payment status\n" +
      "• Order counts\n" +
      "• Completed or active orders\n\n" +
      "Try asking something like \"What is the status of my order?\""
    )
  }


  // ============================================================
  // SEND MESSAGE
  // ============================================================
  async function handleSend() {
    const trimmedMessage = message.trim()

    if (!trimmedMessage || sending) {
      return
    }

    setSending(true)
    setMessage('')

    const userMessage = {
      id: Date.now(),
      sender: 'user',
      text: trimmedMessage,
    }

    setMessages((previous) => [
      ...previous,
      userMessage,
    ])

    /* Short delay to make it feel natural */
    await new Promise((resolve) => {
      setTimeout(resolve, 400)
    })

    const response = generateResponse(trimmedMessage)

    const botMessage = {
      id: Date.now() + 1,
      sender: 'bot',
      text: response,
    }

    setMessages((previous) => [
      ...previous,
      botMessage,
    ])

    setSending(false)
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
  // QUICK QUESTIONS
  // ============================================================
  function askQuickQuestion(question) {
    setMessage(question)

    setTimeout(() => {
      handleSend()
    }, 50)
  }


  // ============================================================
  // RENDER MESSAGE
  // ============================================================
  function renderMessageText(text) {
    const parts = text.split('**')

    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return (
          <strong key={index}>
            {part}
          </strong>
        )
      }

      return (
        <span key={index}>
          {part}
        </span>
      )
    })
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
        <div className="fixed bottom-24 right-6 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">

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
                    max-w-[78%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${chatMessage.sender === 'user' ? 'rounded-br-md bg-[#2D5A42] text-white' : 'rounded-bl-md border border-gray-200 bg-white text-gray-700 shadow-sm'}
                  `}
                >
                  {renderMessageText(chatMessage.text)}
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
                <button
                  type="button"
                  onClick={() => askQuickQuestion('What is the status of my orders?')}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-[#2D5A42] hover:bg-[#F4F8F5] hover:text-[#1F3A2C]"
                >
                  Order status
                </button>

                <button
                  type="button"
                  onClick={() => askQuickQuestion('When will my orders arrive?')}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-[#2D5A42] hover:bg-[#F4F8F5] hover:text-[#1F3A2C]"
                >
                  Delivery
                </button>

                <button
                  type="button"
                  onClick={() => askQuickQuestion('Do I have any pending payments?')}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-[#2D5A42] hover:bg-[#F4F8F5] hover:text-[#1F3A2C]"
                >
                  Payments
                </button>

                <button
                  type="button"
                  onClick={() => askQuickQuestion('Help')}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-[#2D5A42] hover:bg-[#F4F8F5] hover:text-[#1F3A2C]"
                >
                  Help
                </button>
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
                disabled={sending || loadingOrders}
                placeholder={loadingOrders ? 'Loading your orders...' : 'Ask about your orders...'}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
              />

              <button
                type="button"
                onClick={handleSend}
                disabled={!message.trim() || sending || loadingOrders}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1F3A2C] text-white transition hover:bg-[#2D5A42] disabled:cursor-not-allowed disabled:bg-gray-300"
                aria-label="Send message"
              >
                <FontAwesomeIcon icon={ sending ? faSpinner : faPaperPlane} className={sending ? 'animate-spin text-xs' : 'text-xs'}/>
              </button>
            </div>

            <p className="mt-2 text-center text-[10px] text-gray-400">
              Answers are based on your account information.
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
          onClick={() => setOpen(true)}
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