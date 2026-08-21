import { Navigate, useParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"


export default function ProtectedRoute({children}){
  const { profile, loading } = useAuth()
  const { role } = useParams()

  if(loading){
    return <div>Loading...</div>
  }

  if(!profile){
    return <Navigate to="/" />
  }

  if(profile.role !== role){
    return <Navigate to="/unauthorized" />
  }

  return children
}