import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTags, faFileCircleCheck, faLanguage, faPrint, faClipboardCheck } from '@fortawesome/free-solid-svg-icons'


export default function ComplianceLabelCard({ title, subtitle, summary, loading }) {


  // =====================================================
  // COMPLIANCE LABEL WORKFLOW
  // =====================================================
  const statuses = [
    {
      label: 'Not Started',
      value: summary.notStarted,
      icon: faTags,
    },
    {
      label: 'Original Label Received',
      value: summary.originalLabelReceived,
      icon: faFileCircleCheck,
    },
    {
      label: 'Awaiting Customer Translated Design',
      value: summary.awaitingCustomerTranslatedDesign,
      icon: faLanguage,
    },
    {
      label: 'Customer Design Label Received',
      value: summary.customerDesignLabelReceived,
      icon: faFileCircleCheck,
    },

    {
      label: 'Printed & Awaiting Application',
      value: summary.printedAwaitingApplication,
      icon: faPrint,
    },
    {
      label: 'Applied to Units',
      value: summary.appliedToUnits,
      icon: faClipboardCheck,
    },
  ]


  // =====================================================
  // TOTAL
  // =====================================================
  const total = statuses.reduce((sum, status) => sum + Number(status.value || 0), 0)


  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

      {/* =================================================
          HEADER
      ================================================= */}
      <div className=" flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">

        {/* TITLE */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2D5A42] text-white">
            <FontAwesomeIcon icon={faTags} className={`h-5 w-5 ${loading ? 'animate-pulse' : ''}`}/>
          </div>


          <div>
            <h2 className="font-semibold text-gray-800">
              {title}
            </h2>

            <p className="text-sm text-gray-500">
              {subtitle}
            </p>
          </div>
        </div>


        {/* TOTAL */}
        <div className="flex items-center gap-8">
          <div>
            <p className="text-xs text-gray-400">
              Total Active
            </p>

            <p className="text-xl font-bold text-[#1F3A2C]">
              {loading ? '-' : total}
            </p>
          </div>
        </div>
      </div>


      {/* =================================================
          WORKFLOW TRACKER
      ================================================= */}
      <div className="p-6">
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${ statuses.length >= 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-4'}`}>

          {statuses.map((status, index) => (
            <div key={status.label} className="relative">

              {/* CONNECTING LINE */}
              {index < statuses.length - 1 && (
                <div className="absolute left-[calc(50%+24px)] right-[-12px] top-7 hidden h-px bg-gray-200 xl:block"/>
              )}

              {/* STAGE CARD */}
              <div className="relative z-10 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">

                {/* ICON + COUNT */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#F4F8F5] text-[#2D5A42]">
                    <FontAwesomeIcon icon={status.icon} className="h-5 w-5"/>
                  </div>

                  <div className="text-right">
                    {loading ? (
                      <div className="h-8 w-10 animate-pulse rounded bg-gray-200"/>
                    ) : (
                      <p className=" text-2xl font-bold text-[#1F3A2C]">
                        {status.value}
                      </p>
                    )}
                  </div>
                </div>


                {/* STAGE NAME */}
                <p className="mt-4 min-h-[40px] text-sm font-semibold leading-5 text-gray-700">
                  {status.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}