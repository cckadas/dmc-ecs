import { Navigate, useParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { canOpenPage } from "./layout/navigation"


export default function ProtectedRoute({children}){
  const { profile, loading } = useAuth()
  const { role, page } = useParams()

  if(loading){
    return <div>Loading...</div>
  }

  if(!profile){
    return <Navigate to="/" />
  }

  // The URL's role must be the user's own, and the page must be in that
  // role's menu — typing another page's address doesn't get around it.
  if(profile.role !== role || !canOpenPage(role, page)){
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
