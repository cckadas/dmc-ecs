import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlask } from '@fortawesome/free-solid-svg-icons'


// On figures worked out partly from the made-up demo history (utils/simulated.js).
export default function SimulatedBadge({ label = 'Simulated data', title = "Includes made-up demo records (numbered SIM-…), not DMC's real history." }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
    >
      <FontAwesomeIcon icon={faFlask} className="h-2.5 w-2.5" />
      {label}
    </span>
  )
}
