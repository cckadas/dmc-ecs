'use client'


export default function RoleActivityBadge({ status }) {
  const statusStyles = {

    // -------------------------------------------------
    // Role
    // -------------------------------------------------
    'admin': {
      style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },

    'management': {
      style: 'bg-purple-50 text-purple-700 border-purple-200',
    },

    'procurement': {
      style: 'bg-orange-50 text-orange-700 border-orange-200',
    },

    'sales': {
      style: 'bg-amber-50 text-amber-700 border-amber-200',
    },

    'warehouse': {
      style: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    },


    // -------------------------------------------------
    // Activity
    // -------------------------------------------------
    'active': {
      style: 'bg-green-50 text-green-700 border-green-200',
    },

    'inactive': {
      style: 'bg-red-50 text-red-700 border-red-200',
    },

    'available': {
      style: 'bg-green-50 text-green-700 border-green-200',
    },

    'unavailable': {
      style: 'bg-gray-50 text-gray-700 border-gray-200',
    },

  }

  const normalizedStatus = status?.toLowerCase()

  const config = statusStyles[normalizedStatus] || {
    style: 'bg-gray-50 text-gray-600 border-gray-200',
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
      <span>{displayStatus}</span>
    </span>
  )
}