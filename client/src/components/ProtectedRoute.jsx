import { Navigate, useParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { canOpenPage } from "./layout/navigation"


// =============================================
// PROTECTED ROUTE
//
// Which pages each role may open comes from the same list the sidebar shows
// (NAV_SECTIONS in components/layout/navigation.js), so a page added to the
// menu is allowed automatically and the two can't drift apart.
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

  // The role in the URL must match the authenticated user's role.
  if (!userRole || routeRole !== userRole) {
    return <Navigate to="/unauthorized" replace />
  }

  // The page must be in that role's menu — typing another page's address
  // doesn't get around it. Unrecognized roles have no pages at all.
  if (!requestedPage || !canOpenPage(userRole, requestedPage)) {
    return <Navigate to="/unauthorized" replace />
  }

  // All checks passed.
  return children
}
