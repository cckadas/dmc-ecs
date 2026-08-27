'use client'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faClock,
  faFileInvoice,
  faCheck,
  faCircleCheck,
  faXmark,
  faBan,
  faSpinner,
  faCreditCard,
  faHourglassEnd,
  faReceipt,
  faCircleXmark,
  faDolly,
  faPaperPlane,
  faTruckRampBox,
  faCheckCircle,
  faBoxOpen,
  faWarehouse,
  faCartFlatbed,
  faPlaneDeparture,
  faInbox,
  faLanguage,
  faFileCircleCheck,
  faPrint,
  faStickyNote,
} from '@fortawesome/free-solid-svg-icons'

export default function StatusBadge({ status }) {
  const statusStyles = {

    // -------------------------------------------------
    // GENERAL
    // -------------------------------------------------
    'pending': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: faClock,
    },

    'pending approval': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: faClock,
    },

    'awaiting pricing': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: faClock,
    },

    'priced & sent to customer': {
      style: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: faFileInvoice,
    },

    'approved': {
      style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: faCheck,
    },

    'completed': {
      style: 'bg-green-50 text-green-700 border-green-200',
      icon: faCircleCheck,
    },

    'rejected': {
      style: 'bg-red-50 text-red-700 border-red-200',
      icon: faXmark,
    },

    'cancelled': {
      style: 'bg-red-50 text-red-700 border-red-200',
      icon: faBan,
    },

    'processing': {
      style: 'bg-purple-50 text-purple-700 border-purple-200',
      icon: faSpinner,
      animate: true,
    },

    'expired': {
      style: 'bg-gray-50 text-gray-600 border-gray-200',
      icon: faHourglassEnd,
    },

    'pending payment': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: faCreditCard,
    },


    // -------------------------------------------------
    // PAYMENT
    // -------------------------------------------------
    'unpaid': {
      style: 'bg-gray-50 text-gray-600 border-gray-200',
      icon: faCreditCard,
    },

    'down payment received': {
      style: 'bg-blue-50 text-blue-600 border-blue-200',
      icon: faCreditCard,
    },

    'fully paid': {
      style: 'bg-green-50 text-green-600 border-green-200',
      icon: faCreditCard,
    },


    // -------------------------------------------------
    // CUSTOMER ORDER
    // -------------------------------------------------
    'submitted': {
      style: 'bg-sky-50 text-sky-700 border-sky-200',
      icon: faReceipt,
    },

    'payment rejected': {
      style: 'bg-red-50 text-red-700 border-red-200',
      icon: faCircleXmark,
    },

    'payment verified': {
      style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: faCircleCheck,
    },

    'procurement': {
      style: 'bg-orange-50 text-orange-700 border-orange-200',
      icon: faDolly,
    },

    'warehouse preparation': {
      style: 'bg-cyan-50 text-cyan-700 border-cyan-200',
      icon: faWarehouse,
    },

    'ready for shipment': {
      style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: faCartFlatbed,
    },

    'shipped': {
      style: 'bg-green-50 text-green-700 border-green-200',
      icon: faPlaneDeparture,
    },


    // -------------------------------------------------
    // PURCHASE ORDER
    // -------------------------------------------------
    'sent to supplier': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: faPaperPlane,
    },

    'payment sent to supplier': {
      style: 'bg-sky-50 text-sky-700 border-sky-200',
      icon: faReceipt,
    },

    'awaiting delivery': {
      style: 'bg-sky-50 text-sky-700 border-sky-200',
      icon: faTruckRampBox,
    },

    'partially delivered': {
      style: 'bg-lime-50 text-lime-700 border-lime-200',
      icon: faBoxOpen,
    },

    'fully delivered': {
      style: 'bg-green-50 text-green-700 border-green-200',
      icon: faCheckCircle,
    },


    // -------------------------------------------------
    // COMPLIANCE LABEL
    // -------------------------------------------------
    'not started': {
      style: 'bg-gray-50 text-gray-700 border-gray-200',
      icon: faClock,
    },

    'original label received': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: faInbox,
    },

    'awaiting customer translated design': {
      style: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: faLanguage,
    },

    'customer design label received': {
      style: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      icon: faFileCircleCheck,
    },

    'printed & awaiting application': {
      style: 'bg-purple-50 text-purple-700 border-purple-200',
      icon: faPrint,
    },

    'applied to units': {
      style: 'bg-green-50 text-green-700 border-green-200',
      icon: faStickyNote,
    },
  }

  const normalizedStatus = status?.toLowerCase()

  const config = statusStyles[normalizedStatus] || {
    style: 'bg-gray-50 text-gray-600 border-gray-200',
    icon: faClock,
  }

  const displayStatus = status
    ? status
        .toLowerCase()
        .split(' ')
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1)
        )
        .join(' ')
    : 'Unknown'

  return (
    <span
      className={`
        inline-flex
        items-center
        justify-center
        gap-1.5
        rounded-full
        border
        px-3
        py-1.5
        text-xs
        font-semibold
        leading-none
        ${config.style}
      `}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        <FontAwesomeIcon
          icon={config.icon}
          className={`h-3 w-3 ${
            config.animate ? 'animate-spin' : ''
          }`}
        />
      </span>

      <span>{displayStatus}</span>
    </span>
  )
}