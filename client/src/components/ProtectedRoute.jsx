
import { Navigate, useParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"


// =============================================
// PAGE ACCESS PERMISSIONS
// =============================================
const allowedPagesByRole = {
  admin: [
    "executive-dashboard",
    "pfi-builder",
    "customer-orders",
    "billings",
    "purchase-orders",
    "suppliers",
    "supplier-performance",
    "compliance-label-sales",
    "warehouse-holdings",
    "warehouse-locations",
    "product-catalog",
    "customers",
    "accounts",
    "settings",
  ],

  management: [
    "executive-dashboard",
    "supplier-performance",
  ],

  procurement: [
    "dashboard",
    "purchase-orders",
    "suppliers",
    "supplier-performance",
    "product-catalog",
  ],

  warehouse: [
    "dashboard",
    "purchase-orders",
    "receiving",
    "compliance-label-warehouse",
    "staging-tracker",
    "warehouse-holdings",
    "warehouse-locations",
  ],

  sales: [
    "dashboard",
    "pfi-builder",
    "customer-orders",
    "billings",
    "compliance-label-sales",
    "product-catalog",
    "customers",
  ],

  customer: [
    "dashboard",
    "delivery-locations",
    "product-catalog",
    "quotation-requests",
    "my-orders",
    "payments",
    "documents",
    "compliance-label-customer",
  ],
}

// =============================================
// PROTECTED ROUTE
// =============================================
export default function ProtectedRoute({ children }) {
  const { profile, loading } = useAuth()
  const { role, page } = useParams()

  // Wait for authentication to finish loading.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-600">
        Loading...
      </div>
    )
  }

  // Require an authenticated user.
  if (!profile) {
    return <Navigate to="/" replace />
  }

  const userRole = profile.role?.trim().toLowerCase()
  const routeRole = role?.trim().toLowerCase()
  const requestedPage = page?.trim().toLowerCase()

  // Reject invalid or unrecognized roles.
  if (!userRole || !allowedPagesByRole[userRole]) {
    return <Navigate to="/unauthorized" replace />
  }

  // The role in the URL must match the authenticated user's role.
  if (routeRole !== userRole) {
    return <Navigate to="/unauthorized" replace />
  }

  // Reject pages not assigned to the authenticated user's role.
  const allowedPages = allowedPagesByRole[userRole]

  if (!requestedPage || !allowedPages.includes(requestedPage)) {
    return <Navigate to="/unauthorized" replace />
  }

  // All checks passed.
  return children
}
