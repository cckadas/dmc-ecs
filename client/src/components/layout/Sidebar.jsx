import { useAuth } from '../../context/AuthContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { signOut } from '../../services/authService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faHouse,
  faClipboardList,
  faTruck,
  faBoxesStacked,
  faGear,
  faRightFromBracket,
  faCartShopping,
  faFileLines,
  faShop,
  faChartLine,
  faDolly,
  faTags,
  faWarehouse,
  faUserTag,
  faBagShopping,
  faWallet,
  faFileSignature
} from '@fortawesome/free-solid-svg-icons'

import logo from '../../assets/logo.png'


// =============================================
// SIDEBAR SECTION
// =============================================
const sections = [

  // ---------------------------------------------
  // INTERNALS
  // ---------------------------------------------
  {
    title: 'MAIN',
    items: [
      {
        label: 'Dashboard',
        path: 'dashboard',
        icon: faHouse,
        roles: ['admin', 'warehouse', 'procurement', 'sales', 'customer'],
      },
    ],
  },

  {
    title: 'ORDER MANAGEMENT',
    items: [
      {
        label: 'PFI Builder',
        path: 'pfi-builder',
        icon: faFileSignature,
        roles: ['admin', 'sales'],
      },
      {
        label: 'Customer Orders',
        path: 'customer-orders',
        icon: faCartShopping,
        roles: ['admin', 'sales'],
      },
    ],
  },

  {
    title: 'PROCUREMENT',
    items: [
      {
        label: 'Purchase Orders',
        path: 'purchase-orders',
        icon: faTruck,
        roles: ['admin', 'procurement'],
      },
      {
        label: 'Suppliers',
        path: 'suppliers',
        icon: faShop,
        roles: ['admin', 'procurement'],
      },
      {
        label: 'Supplier Performance',
        path: 'supplier-performance',
        icon: faChartLine,
        roles: ['admin', 'procurement'],
      },
    ],
  },

  {
    title: 'WAREHOUSE',
    items: [
      {
        label: 'Receiving',
        path: 'receiving',
        icon: faDolly,
        roles: ['admin', 'warehouse'],
      },
      {
        label: 'Compliance Labels',
        path: 'compliance-labels',
        icon: faTags,
        roles: ['admin', 'warehouse'],
      },
      {
        label: 'Staging',
        path: 'staging',
        icon: faBoxesStacked,
        roles: ['admin', 'warehouse'],
      },
      {
        label: 'Locations',
        path: 'locations',
        icon: faWarehouse,
        roles: ['admin', 'warehouse'],
      },
    ],
  },

  {
    title: 'MASTER DATA',
    items: [
      {
        label: 'Products',
        path: 'product-catalog',
        icon: faBagShopping,
        roles: ['admin', 'sales'],
      },
      {
        label: 'Customers',
        path: 'customers',
        icon: faUserTag,
        roles: ['admin', 'sales'],
      },
    ],
  },
  {
    title: 'ADMIN',
    items: [
      {
        label: 'Settings',
        path: 'settings',
        icon: faGear,
        roles: ['admin'],
      },
    ],
  },


  // ---------------------------------------------
  // CUSTOMERS
  // ---------------------------------------------
  {
    title: 'ORDERING',
    items: [
      {
        label: 'Delivery Locations',
        path: 'delivery-locations',
        icon: faTruck,
        roles: ['customer'],
      },
      {
        label: 'Product Catalog',
        path: 'product-catalog',
        icon: faBagShopping,
        roles: ['customer'],
      },
      {
        label: 'Quotation Requests',
        path: 'quotation-requests',
        icon: faFileLines,
        roles: ['customer'],
      },
      {
        label: 'My Orders',
        path: 'my-orders',
        icon: faCartShopping,
        roles: ['customer'],
      },
    ],
  },

  {
    title: 'PAYMENTS',
    items: [
      {
        label: 'Payments',
        path: 'payments',
        icon: faWallet,
        roles: ['customer'],
      },
      {
        label: 'Documents',
        path: 'documents',
        icon: faClipboardList,
        roles: ['customer'],
      },
    ],
  },

  {
    title: 'COMPLIANCE',
    items: [
      {
        label: 'Compliance Labels',
        path: 'compliance-labels',
        icon: faTags,
        roles: ['customer'],
      },
    ],
  },
]



export default function Sidebar({ collapsed }) {
  const { profile } = useAuth()
  
  const navigate = useNavigate()
  const location = useLocation()

  const userRole = profile?.role


  // =============================================
  // HANDLE NAVIGATION
  // =============================================
  function handleNavigation(path) {
    if (!userRole) return
    navigate(`/${userRole}/${path}`)
  }


  return (
    <aside className={`fixed left-0 top-0 flex h-screen flex-col bg-[#1F3A2C] text-white shadow-2xl transition-all duration-300 ${ collapsed ? 'w-24' : 'w-72' }`}>

      {/* ======= LOGO ======= */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className={`flex items-center ${ collapsed ? 'justify-center' : 'gap-4' }`}>
          <img
            src={logo}
            alt="DMC ECS Logo"
            className={`shrink-0 rounded-lg bg-white p-1 transition-all duration-300 ${
              collapsed ? 'h-12 w-12' : 'h-14 w-14'
            }`}
          />

          {!collapsed && (
            <div>
              <h1 className="text-xl font-bold">
                DMC ECS
              </h1>

              <p className="text-xs text-gray-400">
                Export Consolidation System
              </p>
            </div>
          )}
        </div>
      </div>


      {/* ======= NAVIGATION ======= */}
      <div
        className="
          flex-1 overflow-y-auto px-3 py-5
          [&::-webkit-scrollbar]:w-2
          [&::-webkit-scrollbar-track]:bg-[#1F3A2C]
          [&::-webkit-scrollbar-thumb]:bg-[#2D5A42]
          [&::-webkit-scrollbar-thumb]:rounded-full
          hover:[&::-webkit-scrollbar-thumb]:bg-[#3B7556]
          scrollbar-width-thin
        "
      >

        {sections.map((section) => {
          const allowedItems = section.items.filter(item =>
            item.roles.includes(userRole)
          )

          if (allowedItems.length === 0) {
            return null
          }

          return (
            <div key={section.title} className="mb-7">

              {!collapsed && (
                <div
                  className="
                    mb-2 flex items-center gap-2 px-3
                    text-[11px] font-semibold uppercase
                    tracking-[0.18em]
                    text-green-300/70
                  "
                >

                  <span>
                    {section.title}
                  </span>
                </div>
              )}

              <div className="space-y-1">
                {allowedItems.map((item)=>{
                  const active = location.pathname === `/${userRole}/${item.path}`

                  return (
                    <button
                      key={item.label}
                      onClick={() => handleNavigation(item.path)}

                      className={`group flex w-full items-center rounded-lg px-3 py-2.5 transition
                        ${ collapsed ? 'justify-center' : 'gap-3'}
                        ${ active ? 'bg-white/10 text-white' : 'text-white hover:bg-white/5'}
                      `}
                    >

                      <FontAwesomeIcon icon={item.icon}/>

                      {!collapsed && (
                        <span>
                          {item.label}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>


      {/* ======= LOGOUT ======= */}
      <div className="border-t border-white/10 px-3 py-1">
        <button
          onClick={signOut}
          className={`
            group flex w-full items-center rounded-lg
            px-3 py-2.5 transition
            ${ collapsed ? 'justify-center' : 'gap-3'}
            text-red-300 hover:bg-red-500/10 hover:text-red-200
          `}
        >

          <FontAwesomeIcon icon={faRightFromBracket}/>

          {!collapsed && (
            <span>
              Sign Out
            </span>
          )}

        </button>
      </div>
    </aside>
  )
}