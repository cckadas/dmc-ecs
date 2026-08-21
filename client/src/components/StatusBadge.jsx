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
  faDolly
} from '@fortawesome/free-solid-svg-icons'


export default function StatusBadge({ status }) {

  const statusStyles = {
    'pending': {
      style: 'bg-yellow-100 text-yellow-700',
      icon: faClock,
    },
    
    'pending approval': {
      style: 'bg-yellow-100 text-yellow-700',
      icon: faClock,
    },

    'quoted': {
      style: 'bg-blue-100 text-blue-700',
      icon: faFileInvoice,
    },

    'approved': {
      style: 'bg-green-100 text-green-700',
      icon: faCheck,
    },

    'completed': {
      style: 'bg-green-100 text-green-700',
      icon: faCircleCheck,
    },

    'rejected': {
      style: 'bg-red-100 text-red-700',
      icon: faXmark,
    },

    'cancelled': {
      style: 'bg-red-100 text-red-700',
      icon: faBan,
    },

    'processing': {
      style: 'bg-purple-100 text-purple-700',
      icon: faSpinner,
    },

    'expired': {
      style: 'bg-gray-100 text-gray-700',
      icon: faHourglassEnd,
    },



    'pending payment': {
      style: 'bg-yellow-100 text-yellow-700',
      icon: faCreditCard,
    },

    'submitted': {
      style: 'bg-blue-100 text-blue-700',
      icon: faReceipt,
    },

    'payment rejected': {
      style: 'bg-red-100 text-red-700',
      icon: faCircleXmark,
    },

    'payment verified': {
      style: 'bg-green-100 text-green-700',
      icon: faCircleCheck,
    },

    'procurement': {
      style: 'bg-orange-100 text-orange-700',
      icon: faDolly,
    },
  }


  const config = statusStyles[status] || {
    style: 'bg-gray-100 text-gray-700',
    icon: faClock,
  }


  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${config.style}`}>
      <FontAwesomeIcon icon={config.icon} className="h-3 w-3"/>

      {status
        ? status
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
        : 'Unknown'}
    </span>
  )
}