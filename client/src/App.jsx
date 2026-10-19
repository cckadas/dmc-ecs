
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"

import LoginPage from "./pages/Login"
import PrivacyPolicyPage from "./pages/PrivacyPolicy"
import TermsOfServicePage from "./pages/TermsOfService"
import ProtectedRoute from "./components/ProtectedRoute"
import Layout from "./components/layout/Layout"
import SetPasswordPage from "./pages/SetPassword"

import PageRouter from "./pages/PageRouter"
import UnauthorizedPage from "./pages/Unauthorized"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* =============================================
            PUBLIC PAGES
        ============================================= */}
        <Route
          path="/"
          element={<LoginPage />}
        />

        <Route
          path="/privacy-policy"
          element={<PrivacyPolicyPage />}
        />

        <Route
          path="/terms-of-service"
          element={<TermsOfServicePage />}
        />

        <Route
          path="/set-password"
          element={<SetPasswordPage />}
        />

        <Route
          path="/unauthorized"
          element={<UnauthorizedPage />}
        />

        {/* =============================================
            PROTECTED APPLICATION PAGES
        ============================================= */}
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

        {/* =============================================
            UNKNOWN URLS
        ============================================= */}
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
        
      </Routes>
    </BrowserRouter>
  )
}
