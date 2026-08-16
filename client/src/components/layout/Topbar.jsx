import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBars,
  faChevronDown,
  faUserCircle,
  faChevronUp
} from '@fortawesome/free-solid-svg-icons'

import { useAuth } from '../../context/AuthContext'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'

import { signOut } from '../../services/authService'


export default function Topbar({ collapsed, onToggleSidebar }) {

  const { profile } = useAuth()
  const location = useLocation()

  const [openProfile, setOpenProfile] = useState(false)

  const currentPage = location.pathname
    .split('/')
    .filter(Boolean)
    .pop()

  const pageTitle = !currentPage
    ? 'Dashboard'
    : currentPage
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    
  return (
    <header
      className={`fixed right-0 top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 transition-all duration-300 ${
        collapsed ? 'left-24' : 'left-72'
      }`}
    >

      {/* Left */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-all duration-200 hover:border-green-600 hover:bg-green-50 hover:text-green-700 hover:shadow-md"
        >
          <FontAwesomeIcon icon={faBars} className="text-base" />
        </button>

        <div className="text-sm">
          <span className="font-semibold text-green-700">
            DMC ECS
          </span>

          <span className="mx-2 text-gray-300">
            /
          </span>

          <span className="text-gray-600">
            {pageTitle}
          </span>
        </div>
      </div>


      {/* Right */}
      <div className="relative">

        <button
          onClick={() => setOpenProfile(!openProfile)}
          className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 shadow-sm transition-all duration-200 hover:border-green-600 hover:bg-green-50 hover:shadow-md"
        >

          <FontAwesomeIcon
            icon={faUserCircle}
            className="text-3xl text-green-700"
          />

          <div className="text-left leading-none">
            <p className="text-sm font-semibold text-gray-800 leading-none">
              {profile?.name || ''}
            </p>

            <p className="mt-1 text-[12px] leading-none text-gray-500">
              {profile?.role
                ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
                : 'No role'}
            </p>
          </div>

          <FontAwesomeIcon
            icon={ openProfile ? faChevronUp : faChevronDown }
            className={`
              text-[10px] text-gray-400 ps-2
              transition-transform duration-200
            `}
          />
        </button>


        {/* Profile Dropdown */}
        {openProfile && (
          <ProfileDropdown profile={profile} />
        )}

      </div>
    </header>
  )
}


function ProfileDropdown({ profile }) {
  return (
    <div
      className="
        absolute right-0 mt-3 w-72
        rounded-xl border border-gray-200
        bg-white p-5 shadow-xl
      "
    >

      <div className="mb-4 border-b border-gray-100 pb-4">
        <p className="text-lg font-semibold text-gray-800">
          {profile?.name}
        </p>

        <p className="text-sm text-gray-500">
          {profile?.email}
        </p>
      </div>


      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">
            Role
          </span>

          <span className="font-medium text-gray-800">
            {profile?.role}
          </span>
        </div>


        <div className="flex justify-between">
          <span className="text-gray-500">
            Account
          </span>

          <span className="font-medium text-green-700">
            Active
          </span>
        </div>
      </div>

      <button
        onClick={signOut}
        className="
          mt-5 w-full rounded-lg
          bg-red-600 py-2
          text-sm font-semibold
          text-white
          transition
          hover:bg-red-700
        "
      >
        Sign Out
      </button>
    </div>
  )
}