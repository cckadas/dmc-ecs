import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import bg1 from '../assets/bg_1.jpg'
import bg2 from '../assets/bg_2.jpg'
import bg3 from '../assets/bg_3.jpg'
import {
  faRocket,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'


export default function DashboardPage() {
  const { profile } = useAuth()

  const role = profile?.role

  const backgrounds = [bg1, bg2, bg3]

  const [currentBg, setCurrentBg] = useState(0)



  // =============================================
  // ROTATE WELCOME CARD BACKGROUND
  // =============================================
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBg((prev) => (
        (prev + 1) % backgrounds.length
      ))
    }, 5000)

    return () => clearInterval(interval)
  }, [])


  return (
    <div className="min-h-full">


      {/* =============================================
          WELCOME CARD
      ============================================= */}
      <div className="relative mb-6 min-h-[300px] overflow-hidden rounded-2xl shadow-lg">


        {/* Rotating Background */}
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-1000"
          style={{
            backgroundImage: `url(${backgrounds[currentBg]})`,
          }}
        />


        {/* Dark Overlay */}
        <div className="absolute inset-0 bg-[#1F3A2C]/70" />


        {/* Content */}
        <div className="relative z-10 flex min-h-[300px] flex-col justify-center px-8 py-10 lg:px-12">

          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
            DMC Export Consolidation System
          </p>

          <h2 className="max-w-2xl text-4xl font-bold text-white lg:text-5xl">
            Welcome to DMC ECS
          </h2>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80">
            Manage and monitor your export consolidation operations from one
            centralized system with streamlined workflows and better visibility.
          </p>


          {/* Role Badge */}
          {role && (
            <div className="mt-6">

              <span className="inline-flex rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold uppercase text-white backdrop-blur-sm">
                {role} Access
              </span>

            </div>
          )}

        </div>

      </div>


      {/* =============================================
          FEATURES SHIPPING SOON
      ============================================= */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">

        <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-5">

          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2D5A42] text-white">

            <FontAwesomeIcon
              icon={faRocket}
              className="h-5 w-5"
            />

          </div>


          <div>

            <h2 className="font-semibold text-gray-800">
              Features Shipping Soon
            </h2>

            <p className="text-sm text-gray-500">
              More dashboard features are currently being prepared.
            </p>

          </div>

        </div>


        <div className="flex flex-col items-start justify-between gap-5 px-6 py-6 sm:flex-row sm:items-center">

          <div>

            <p className="font-medium text-gray-700">
              New tools and analytics are on the way.
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Role-specific dashboards, reports, analytics, and operational
              insights will be available here soon.
            </p>

          </div>


          <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-[#2D5A42]">

            Coming Soon

            <FontAwesomeIcon
              icon={faArrowRight}
              className="h-4 w-4"
            />

          </div>

        </div>

      </div>

    </div>
  )
}