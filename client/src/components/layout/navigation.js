import {
  faHouse,
  faClipboardList,
  faTruck,
  faBoxesStacked,
  faGear,
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
  faFileSignature,
  faCartFlatbed,
  faCreditCard,
  faCircleUser,
  faPesoSign,
  faScaleBalanced
} from '@fortawesome/free-solid-svg-icons'


// =============================================
// NAVIGATION
//
// The single list of pages each role can use. The sidebar shows it, and
// ProtectedRoute only lets a role open the pages listed for it here, so a page
// typed into the address bar is blocked unless it is in that role's menu.
// =============================================
export const NAV_SECTIONS = [

  // ---------------------------------------------
  // INTERNALS
  // ---------------------------------------------
  {
    title: 'MAIN',
    items: [
      {
        label: 'Dashboard',
        path: 'executive-dashboard',
        icon: faHouse,
        roles: ['admin', 'management'],
      },
      {
        label: 'Dashboard',
        path: 'dashboard',
        icon: faHouse,
        roles: ['warehouse', 'procurement', 'sales', 'customer'],
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
      {
        label: 'Billings',
        path: 'billings',
        icon: faCreditCard,
        roles: ['admin', 'sales'],
      },
      {
        label: 'Markups & Credit',
        path: 'pricing-credit',
        icon: faScaleBalanced,
        roles: ['admin', 'management'],
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
        roles: ['admin', 'procurement', 'warehouse'],
      },
      {
        label: 'Suppliers',
        path: 'suppliers',
        icon: faShop,
        roles: ['admin', 'procurement'],
      },
      {
        label: 'Price Lists',
        path: 'price-lists',
        icon: faPesoSign,
        roles: ['admin', 'procurement'],
      },
      {
        label: 'Supplier Performance',
        path: 'supplier-performance',
        icon: faChartLine,
        roles: ['admin', 'management', 'procurement'],
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
        roles: ['warehouse'],
      },
      {
        label: 'Compliance Labels',
        path: 'compliance-label-sales',
        icon: faTags,
        roles: ['admin', 'sales'],
      },
      {
        label: 'Compliance Labels',
        path: 'compliance-label-warehouse',
        icon: faTags,
        roles: ['warehouse'],
      },
      {
        label: 'Staging',
        path: 'staging-tracker',
        icon: faBoxesStacked,
        roles: ['warehouse'],
      },
      {
        label: 'Warehouse Holdings',
        path: 'warehouse-holdings',
        icon: faCartFlatbed,
        roles: ['admin', 'warehouse'],
      },
      {
        label: 'Warehouse Locations',
        path: 'warehouse-locations',
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
        roles: ['admin', 'sales', 'procurement'],
      },
      {
        label: 'Customers',
        path: 'customers',
        icon: faUserTag,
        roles: ['admin', 'sales'],
      },
      {
        label: 'Accounts',
        path: 'accounts',
        icon: faCircleUser,
        roles: ['admin'],
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
        path: 'compliance-label-customer',
        icon: faTags,
        roles: ['customer'],
      },
    ],
  },
]


// Whether a role may open a page, e.g. canOpenPage('customer', 'settings').
export function canOpenPage(role, page) {
  return NAV_SECTIONS.some((section) =>
    section.items.some((item) => item.path === page && item.roles.includes(role))
  )
}


// Where each role lands after signing in, or null for a role with no pages.
export function homePath(role) {
  const home = role === 'admin' || role === 'management' ? 'executive-dashboard' : 'dashboard'
  return canOpenPage(role, home) ? `/${role}/${home}` : null
}
