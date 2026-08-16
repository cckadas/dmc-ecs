import { BrowserRouter, Routes, Route } from "react-router-dom"

import LoginPage from "./pages/Login"
import ProtectedRoute from "./components/ProtectedRoute"
import Layout from "./components/layout/Layout"
import SetPasswordPage from "./pages/SetPassword"

import PageRouter from "./pages/PageRouter"
import UnauthorizedPage from "./pages/Unauthorized"


export default function App(){
  return (
    <BrowserRouter>
      <Routes>

        <Route 
          path="/" 
          element={<LoginPage />}
        />

        <Route
          path="/:role/:page"
          element={
            <ProtectedRoute>
              <Layout>
                <PageRouter />
              </Layout>
            </ProtectedRoute>
          }
        />

        <Route 
          path="/set-password" 
          element={<SetPasswordPage />}
        />

        <Route
          path="/unauthorized"
          element={<UnauthorizedPage />}
        />

      </Routes>
    </BrowserRouter>
  )
}