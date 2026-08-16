import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import logo from '../assets/logo.png'
import bg1 from '../assets/bg_1.jpg'
import bg2 from '../assets/bg_2.jpg'
import bg3 from '../assets/bg_3.jpg'


export default function UnauthorizedPage() {
  const navigate = useNavigate()

  const backgrounds = [bg1, bg2, bg3]
  const [currentBg] = useState(0)


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

      {/* Unauthorized Card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/20 bg-white/95 p-10 shadow-2xl backdrop-blur-md">

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-red-600">
            Unauthorized Access
          </h1>

          <p className="mt-5 text-sm leading-7 text-gray-600">
            You don't have permission to access this page.
            <br />
            Please sign in using an authorized account to continue using the
            <span className="font-semibold text-green-700">
              {" "}DMC Export Consolidation System
            </span>.
          </p>
        </div>

        <button
          onClick={() => navigate(`/`)}
          className="w-full rounded-lg bg-green-700 py-3 font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          Return to Login Page
        </button>

      </div>
    </div>
  )
}