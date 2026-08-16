import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn } from '../services/authService'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons'

import logo from '../assets/logo.png'
import bg1 from '../assets/bg_1.jpg'
import bg2 from '../assets/bg_2.jpg'
import bg3 from '../assets/bg_3.jpg'


export default function LoginPage() {
  const navigate = useNavigate()
  const { setProfile } = useAuth()

  const backgrounds = [bg1, bg2, bg3]
  const [currentBg, setCurrentBg] = useState(0)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)


  // =============================================
  // LOGIN
  // =============================================
  async function handleLogin() {
    if (!email || !password) {
      alert('Please enter your email and password.')
      return
    }

    setLoading(true)

    const { data, error } = await signIn(email, password)

    if (error) {
      setLoading(false)
      alert(error.message)
      return
    }

    const user = data.user

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    setLoading(false)

    if (profileError) {
      alert(profileError.message)
      return
    }

    setProfile(profile)
    handleNavigation(profile)
  }


  // =============================================
  // NAVIGATION REDIRECTION
  // =============================================
  async function handleNavigation(profile) {
    const userRole = profile.role

    if(userRole === "admin"){
      navigate("/admin/dashboard")
    }

    else if(userRole === "warehouse"){
      navigate("/warehouse/dashboard")
    }

    else if(userRole === "customer"){
      navigate("/customer/dashboard")
    }

    else{
      navigate("/unauthorized")
    }
  }


  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBg((prev) => (prev + 1) % backgrounds.length)
    }, 5000) 

    return () => clearInterval(interval)
  }, [])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">

      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-1000"
        style={{
          backgroundImage: `url(${backgrounds[currentBg]})`,
          filter: 'sepia(15%) saturate(65%) hue-rotate(15deg) brightness(75%)',
        }}
      />

      {/* Green + Dark overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-green-900/40 via-black/55 to-black/65" />

      {/* Logo */}
      <div className="absolute left-8 top-8 z-20 flex items-center gap-3">
        <img
          src={logo}
          alt="DMC Logo"
          className="h-14 w-14 object-contain"
        />

        <div>
          <h2 className="text-2xl font-bold tracking-wide text-white">
            DMC ECS
          </h2>
          <p className="text-sm text-green-200">
            Export Consolidation System
          </p>
        </div>
      </div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/20 bg-white/95 p-10 shadow-2xl backdrop-blur-md">

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome to DMC ECS
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-600">
            Sign in to the
            <span className="font-semibold text-green-700">
              {" "}DMC Export Consolidation System
            </span>
            <br/>and manage orders, procurement, customers, suppliers, warehouse operations, and shipments in one platform.
          </p>
        </div>

        <input
          type="email"
          placeholder="Email Address"
          className="mb-4 w-full rounded-lg border border-gray-300 p-3 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="relative mb-6">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            className="w-full rounded-lg border border-gray-300 p-3 pr-12 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute inset-y-0 right-0 flex items-center px-4 text-gray-500 transition hover:text-green-700"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
          </button>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full rounded-lg bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {loading ? 'Signing In...' : 'Sign In'}
        </button>

        <p className="mt-6 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} DMC Export Consolidation System
        </p>

      </div>
    </div>
  )
}