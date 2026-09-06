import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { signOut } from '../../services/authService'
import { supabase } from '../../supabase'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import { faBars, faChevronDown, faUserCircle, faChevronUp, faBell, faCheck, faCircleInfo, faTriangleExclamation, faCircleCheck, faXmark } from '@fortawesome/free-solid-svg-icons'


export default function Topbar({ collapsed, onToggleSidebar }) {

  const { profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [openProfile, setOpenProfile] = useState(false)
  const [openNotifications, setOpenNotifications] = useState(false)

  const [notifications, setNotifications] = useState([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)

  const profileRef = useRef(null)
  const notificationRef = useRef(null)

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


  const role = profile?.role?.toLowerCase()


  // =====================================================
  // LOAD NOTIFICATIONS
  // =====================================================
  async function loadNotifications() {
    setLoadingNotifications(true)

    try {
      let query = supabase
        .from('notifications')
        .select(`
          id,
          user_id,
          role,
          title,
          message,
          type,
          is_read,
          link,
          created_at
        `)
        .order('created_at', {
          ascending: false
        })
        .limit(30)

      if (role === 'customer') {
        query = query
          .eq('role', 'customer')
          .eq('user_id', profile.id)
      } 
      
      else if (role === 'admin') {
        query = query.neq('role', 'customer')

      }
      
      else {
        query = query.eq('role', role)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to load notifications:', error)
        return
      }

      setNotifications(data || [])
    } catch (error) {
      console.error('Notification loading error:', error)
    } finally {
      setLoadingNotifications(false)
    }
  }


  // =====================================================
  // NOTIFICATIONS INITIAL LOAD
  // =====================================================
  useEffect(() => {
    if (!profile?.id || !role) {
      setNotifications([])
      return
    }

    loadNotifications()
  }, [profile?.id, role])


  // =====================================================
  // NOTIFICATIONS LISTENER
  // =====================================================
  useEffect(() => {
    if (!profile?.id || !role) {
      return
    }

    const channelName = `notifications-${role}-${profile.id}`
    const channel = supabase.channel(channelName)

    if (role === 'customer') {
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        payload => {
          const notification = payload.new

          if (notification.role !== 'customer') {
            return
          }

          setNotifications(previous => {
            const alreadyExists = previous.some(item => item.id === notification.id)
            if (alreadyExists) { return previous }
            return [ notification, ...previous ]
          })
        }
      )
    }

    else {
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `role=eq.${role}`,
        },
        payload => {
          const notification = payload.new

          setNotifications(previous => {
            const alreadyExists = previous.some(item => item.id === notification.id)
            if (alreadyExists) { return previous }
            return [ notification, ...previous ]
          })
        }
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id, role])


  // =====================================================
  // CLOSE DROPDOWNS WHEN CLICKING OUTSIDE
  // =====================================================
  useEffect(() => {
    function handleClickOutside(event) {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setOpenProfile(false)
      }

      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setOpenNotifications(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])


  // =====================================================
  // MARK AS READ
  // =====================================================
  async function markAsRead(notification) {
    if (notification.is_read) {
      return
    }

    let query = supabase
      .from('notifications')
      .update({
        is_read: true,
      })
      .eq('id', notification.id)

    if (role === 'customer') {
      query = query.eq('user_id', profile.id)
    }

    const { error } = await query

    if (error) {
      console.error('Failed to mark notification as read:', error)
      return
    }

    setNotifications(previous =>
      previous.map(item =>
        item.id === notification.id
          ? { ...item, is_read: true }
          : item
      )
    )
  }


  // =====================================================
  // MARK ALL AS READ
  // =====================================================
  async function markAllAsRead() {
    const unreadNotifications = notifications.filter(notification => !notification.is_read)

    if (unreadNotifications.length === 0) {
      return
    }

    const unreadIds = unreadNotifications.map(notification => notification.id)

    let query = supabase
      .from('notifications')
      .update({
        is_read: true,
      })
      .in('id', unreadIds)


    if (role === 'customer') {
      query = query.eq('user_id', profile.id)
    }
    
    else {
      query = query.eq('role', role)
    }

    const { error } = await query

    if (error) {
      console.error('Failed to mark notifications as read:', error)
      return
    }

    setNotifications(previous => previous.map(notification => ({ ...notification, is_read: true })))
  }


  // =====================================================
  // HANDLE NOTIFCATION CLICK
  // =====================================================
  async function handleNotificationClick(notification) {
    await markAsRead(notification)
    setOpenNotifications(false)

    if (notification.link) {
      navigate(`/${role}${notification.link}`)
    }
  }


  // =====================================================
  // NOTIFICATION ICON TYPE HELPER
  // =====================================================
  function getNotificationIcon(type) {
    switch (type) {
      case 'success':
        return faCircleCheck

      case 'warning':
        return faTriangleExclamation

      case 'error':
        return faXmark

      default:
        return faCircleInfo
    }
  }


  // =====================================================
  // NOTIFICATION ICON STYLE HELPER
  // =====================================================
  function getNotificationIconStyle(type) {
    switch (type) {
      case 'success':
        return 'bg-green-100 text-green-700'

      case 'warning':
        return 'bg-yellow-100 text-yellow-600'

      case 'error':
        return 'bg-red-100 text-red-600'

      default:
        return 'bg-blue-100 text-blue-600'
    }
  }


  // =====================================================
  // RELATIVE TIME GETTER
  // =====================================================
  function getRelativeTime(date) {

    if (!date) { return '' }

    const now = new Date()
    const created = new Date(date)

    const difference = Math.floor((now - created) / 1000)

    if (difference < 60) {  return 'Just now' }

    const minutes = Math.floor(difference / 60)
    if (minutes < 60) { return `${minutes}m ago` }


    const hours = Math.floor(minutes / 60)
    if (hours < 24) { return `${hours}h ago` }

    const days = Math.floor(hours / 24)
    if (days < 7) { return `${days}d ago` }

    return created.toLocaleDateString()
  }


  // =====================================================
  // UNREAD COUNT
  // =====================================================
  const unreadCount = notifications.filter(notification => !notification.is_read).length


  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (

    <header className={`fixed right-0 top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-7 transition-all duration-300 ${collapsed ? 'left-24' : 'left-72'}`}>

      {/* =====================================================
          LEFT SECTION
      ===================================================== */}
      <div className="flex items-center gap-4">

        <button
          onClick={onToggleSidebar}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-all duration-200 hover:border-green-600 hover:bg-green-50 hover:text-green-700 hover:shadow-md"
        >
          <FontAwesomeIcon icon={faBars} className="text-base"/>
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


      {/* =========================================================
          RIGHT SECTION
      ========================================================= */}
      <div className="flex items-center gap-3">

        {/* =======================================================
            NOTIFICATION BELL
        ======================================================= */}
        <div ref={notificationRef} className="relative">

          <button
            onClick={() => {
              setOpenNotifications(previous => !previous)
              setOpenProfile(false)
            }}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-all duration-200 hover:border-green-600 hover:bg-green-50 hover:text-green-700 hover:shadow-md"
            aria-label="Notifications"
          >
            <FontAwesomeIcon icon={faBell} className="text-base"/>

            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>


          {/* =====================================================
              NOTIFICATION DROPDOWN
          ===================================================== */}
          {openNotifications && (
            <div className="absolute right-0 mt-3 w-[390px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">

              {/* =====================================================
                  Header
              ===================================================== */}
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Notifications
                  </h3>

                  <p className="mt-0.5 text-xs text-gray-500">
                    {unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up'}
                  </p>
                </div>

                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="flex items-center gap-1.5 text-xs font-medium text-green-700 transition hover:text-green-900"
                  >
                    <FontAwesomeIcon icon={faCheck}/>
                    Mark all as read
                  </button>
                )}
              </div>


              {/* =====================================================
                  Notification List
              ===================================================== */}
              <div className="max-h-[420px] overflow-y-auto">

                {loadingNotifications ? (

                  /* LOADING */
                  <div className="flex items-center justify-center px-5 py-12">
                    <div className="h-6 w-6  animate-spin rounded-full border-2 border-gray-200 border-t-green-700"/>
                  </div>

                ) : notifications.length === 0 ? (

                  /* EMPTY STATE */
                  <div className="px-5 py-12 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <FontAwesomeIcon icon={faBell}/>
                    </div>

                    <p className="text-sm font-medium text-gray-700">
                      No notifications
                    </p>

                    <p className="mt-1 text-xs text-gray-400">
                      You’re all caught up.
                    </p>
                  </div>

                ) : (

                  /* NOTIFICATION ITEMS */
                  notifications.map(
                    notification => (

                      <button
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`flex w-full gap-3 border-b border-gray-100 px-5 py-4 text-left transition hover:bg-gray-50 ${!notification.is_read ? 'bg-green-50/50' : 'bg-white'}`}
                      >

                        {/* Icon */}
                        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${getNotificationIconStyle(notification.type)}`}>
                          <FontAwesomeIcon icon={getNotificationIcon(notification.type)} className="text-sm"/>
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <p className={`flex-1 text-sm ${!notification.is_read ? 'font-semibold text-gray-800' : 'font-medium text-gray-700'}`}>
                              {notification.title}
                            </p>

                            {/* Unread Dot */}
                            {!notification.is_read && (
                              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-green-600"/>
                            )}
                          </div>

                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            {notification.message}
                          </p>

                          <p className="mt-2 text-[11px] text-gray-400">
                            {getRelativeTime(
                              notification.created_at
                            )}
                          </p>
                        </div>
                      </button>
                    )
                  )
                )}
              </div>
            </div>
          )}
        </div>


        {/* =======================================================
            PROFILE
        ======================================================= */}
        <div ref={profileRef} className="relative">

          <button
            onClick={() => {
              setOpenProfile(previous => !previous)
              setOpenNotifications(false)
            }}
            className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 shadow-sm transition-all duration-200 hover:border-green-600 hover:bg-green-50 hover:shadow-md"
          >
            <FontAwesomeIcon icon={faUserCircle} className="text-3xl text-green-700"/>

            <div className="text-left leading-none">
              <p className="text-sm font-semibold leading-none text-gray-800">
                {profile?.name || ''}
              </p>

              <p className="mt-1 text-[12px] leading-none text-gray-500">
                {profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : 'No role'}
              </p>
            </div>

            <FontAwesomeIcon icon={openProfile ? faChevronUp : faChevronDown} className="ps-2 text-[10px] text-gray-400 transition-transform duration-200"/>
          </button>

          {openProfile && (
            <ProfileDropdown profile={profile}/>
          )}

        </div>
      </div>
    </header>
  )
}


// =====================================================
// PROFILE DROPDOWN
// =====================================================
function ProfileDropdown({ profile }) {
  return (
    <div className="absolute right-0 mt-3 w-72 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">

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
            {profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1).toLowerCase() : ''}
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
        className="mt-5 w-full rounded-lg bg-red-600 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
      >
        Sign Out
      </button>

    </div>
  )
}