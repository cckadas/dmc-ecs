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
} from '@fortawesome/free-solid-svg-icons'

export default function StatusBadge({ status }) {
  const statusStyles = {

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