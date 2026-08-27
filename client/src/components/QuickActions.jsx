import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faBolt } from '@fortawesome/free-solid-svg-icons'
import { useNavigate } from 'react-router-dom'


export default function QuickActions({ sections, role }) {
  const navigate = useNavigate()

  const actions = sections
    .flatMap((section) => section.items)
    .filter((item) => item.roles.includes(role))

  if (!actions.length) {
    return null
  }


  // =============================================
  // HANDLE NAVIGATION
  // =============================================
  function handleNavigation(path) {
    if (!role) return
    navigate(`/${role}/${path}`)
  }


  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

      {/* =================================================
          HEADER
      ================================================= */}
      <div className=" flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">

        {/* TITLE */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faBolt} className={`h-5 w-5`}/>
          </div>


          <div>
            <h2 className="font-semibold text-gray-800">
              Quick Actions
            </h2>

            <p className="text-sm text-gray-500">
              Quickly access the tools and features available to you.
            </p>
          </div>
        </div>
      </div>

      
      {/* =============================================
          ACTIONS
      ============================================= */}
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((action) => (
          <button
            key={action.path}
            type="button"
            onClick={() => handleNavigation(action.path)}
            className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-[#2D5A42]/40 hover:bg-[#2D5A42]/5 hover:shadow-sm"
          >

            {/* Icon */}
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#2D5A42]/10 text-[#2D5A42] transition group-hover:bg-[#2D5A42] group-hover:text-white">
              <FontAwesomeIcon icon={action.icon} className="h-5 w-5"/>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-800">
                  {action.label}
                </h3>

                <FontAwesomeIcon icon={faArrowRight} className="h-3.5 w-3.5 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-[#2D5A42]"/>
              </div>

              <p className="mt-0 text-xs leading-relaxed text-gray-500">
                {action.description}
              </p>
            </div>
          </button>
        ))}
      </div>
      
    </div>
  )
}